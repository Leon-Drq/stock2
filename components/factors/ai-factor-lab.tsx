"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { BrainCircuit, CheckCircle2, Clipboard, KeyRound, Loader2, PlusCircle, Settings2, Sparkles } from "lucide-react"
import type { CustomFactor } from "@/lib/custom-factors"
import { upsertCustomFactor } from "@/lib/custom-factors"
import type { FactorDiscoveryCandidate } from "@/lib/factor-lab"
import type { ProviderId } from "@/lib/model-providers"

type DiscoverResponse = {
  source: "ai" | "heuristic"
  warning?: string
  rawContent?: string
  provider?: string
  model?: string | null
  candidate: FactorDiscoveryCandidate
  factor: CustomFactor
  usage?: { total_tokens?: number } | null
}

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

const SAMPLE_IDEAS = [
  "缩量回调但 20 日均线仍在 60 日均线上方，找趋势没坏的股票",
  "放量突破 60 日新高后，3 天内没有明显回落",
  "新闻情绪转正，同时价格还没大涨",
]

export function AIFactorLab({ onSaved }: { onSaved?: () => void }) {
  const [provider, setProvider] = useState<ProviderId>("default")
  const preset = useMemo(() => PROVIDERS.find((item) => item.id === provider) ?? PROVIDERS[0], [provider])
  const [baseUrl, setBaseUrl] = useState(preset.baseUrl)
  const [model, setModel] = useState(preset.model)
  const [apiKey, setApiKey] = useState("")
  const [idea, setIdea] = useState(SAMPLE_IDEAS[0])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DiscoverResponse | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const candidate = result?.candidate
  const dslText = useMemo(() => candidate ? JSON.stringify(candidate.dsl, null, 2) : "", [candidate])

  function selectProvider(next: ProviderId) {
    const nextPreset = PROVIDERS.find((item) => item.id === next) ?? PROVIDERS[0]
    setProvider(next)
    setBaseUrl(nextPreset.baseUrl)
    setModel(nextPreset.model)
    setError(null)
  }

  async function discover() {
    const trimmed = idea.trim()
    if (!trimmed) {
      setError("请先输入因子想法")
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    setSavedId(null)
    try {
      const res = await fetch("/api/factors/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idea: trimmed,
          provider,
          baseUrl: baseUrl.trim() || undefined,
          model: model.trim() || undefined,
          apiKey: apiKey.trim() || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setResult(json as DiscoverResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : "因子生成失败")
    } finally {
      setLoading(false)
    }
  }

  function saveFactor() {
    if (!result?.factor) return
    const saved = upsertCustomFactor(result.factor)
    setSavedId(saved.id)
    onSaved?.()
  }

  async function copyDsl() {
    if (!dslText) return
    await navigator.clipboard.writeText(dslText)
  }

  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(360px,0.78fr)_minmax(0,1.22fr)]">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <BrainCircuit className="size-4" aria-hidden />
            ai factor lab
          </div>
          <h2 className="mt-2 text-[20px] font-semibold text-ink">AI 因子实验台</h2>
          <label className="mt-4 block">
            <span className="mb-2 block font-mono text-[11px] text-ink-muted">自然语言想法</span>
            <textarea
              rows={7}
              value={idea}
              onChange={(event) => setIdea(event.target.value)}
              className="w-full resize-y rounded-[7px] border border-rule bg-[#fafafa] p-3 text-[14px] leading-6 text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            {SAMPLE_IDEAS.map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => setIdea(sample)}
                className="rounded-[6px] border border-rule bg-[#fafafa] px-2 py-1 text-[11px] text-ink-muted hover:text-ink"
              >
                {sample.slice(0, 16)}
              </button>
            ))}
          </div>
          <div className="mt-3 rounded-[7px] border border-rule bg-[#fafafa] p-3">
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
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder={provider === "default" ? "默认模型无需填写" : "Base URL"}
                className="h-9 rounded-[7px] border border-rule bg-white px-3 font-mono text-[11px] text-ink focus:border-ink focus:outline-none"
              />
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                placeholder={provider === "default" ? "默认模型无需填写" : "model"}
                className="h-9 rounded-[7px] border border-rule bg-white px-3 font-mono text-[11px] text-ink focus:border-ink focus:outline-none"
              />
            </div>
            <label className="mt-2 flex h-9 items-center gap-2 rounded-[7px] border border-rule bg-white px-3">
              <KeyRound className="size-3.5 text-ink-muted" aria-hidden />
              <input
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                type="password"
                autoComplete="off"
                placeholder={provider === "default" ? "留空使用平台默认模型" : `API Key，可留空使用服务端 ${preset.keyHint}`}
                className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-ink outline-none placeholder:text-ink-faint"
              />
            </label>
          </div>
          <button
            type="button"
            onClick={discover}
            disabled={loading}
            className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-[7px] bg-ink px-4 font-mono text-[11px] text-white disabled:opacity-50 sm:w-auto"
          >
            {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />}
            {loading ? "生成中" : "发掘候选因子"}
          </button>
          {error && (
            <p className="mt-3 rounded-[7px] border border-bear/20 bg-bear/5 px-3 py-2 text-[12px] leading-5 text-bear">
              {error}
            </p>
          )}
        </div>

        <div className="min-h-[280px] rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
          {!candidate && !loading && (
            <div className="grid h-full place-items-center py-10 text-center">
              <p className="max-w-[42ch] text-[13px] leading-6 text-ink-muted">
                候选因子会显示公式、数据字段、验证门槛和 DSL，保存后进入“我的因子”。
              </p>
            </div>
          )}
          {loading && (
            <div className="grid h-full place-items-center py-10">
              <div className="flex items-center gap-3 font-mono text-[11px] text-ink-muted">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                model running
              </div>
            </div>
          )}
          {candidate && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-[7px] border border-rule bg-white px-3 py-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-[5px] border border-rule bg-[#fafafa] px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
                      {candidate.category}
                    </span>
                    <span className="rounded-[5px] border border-rule bg-[#fafafa] px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
                      {candidate.frequency}
                    </span>
                    <span className={`rounded-[5px] border px-1.5 py-0.5 font-mono text-[10px] ${
                      candidate.validation.ready
                        ? "border-health-ok/30 bg-health-ok/5 text-health-ok"
                        : "border-warning/30 bg-warning/5 text-warning"
                    }`}>
                      {candidate.validation.ready ? "可进入首轮验证" : "需补字段"}
                    </span>
                  </div>
                  <h3 className="mt-2 text-[18px] font-semibold text-ink">{candidate.name}</h3>
                  <p className="mt-2 max-w-[72ch] text-[13px] leading-6 text-ink-muted">{candidate.thesis}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[10px] text-ink-faint">score</p>
                  <p className="font-mono text-[28px] font-semibold text-ink">{candidate.validation.score}</p>
                </div>
              </div>

              {result?.warning && (
                <p className="rounded-[7px] border border-warning/20 bg-warning/5 px-3 py-2 text-[12px] leading-5 text-warning">
                  {result.warning}
                </p>
              )}

              <div className="grid gap-3 xl:grid-cols-2">
                <InfoBlock title="公式" value={candidate.formula} mono />
                <InfoBlock title="实现" value={candidate.implementation} mono />
                <ListBlock title="数据" items={candidate.requiredData} />
                <ListBlock title="字段" items={candidate.requiredFields} />
              </div>

              <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(260px,0.6fr)]">
                <div className="rounded-[7px] border border-rule bg-white px-3 py-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="font-mono text-[10px] text-ink-faint">DSL</p>
                    <button
                      type="button"
                      onClick={copyDsl}
                      className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-rule bg-[#fafafa] px-2 font-mono text-[10px] text-ink-muted"
                    >
                      <Clipboard className="size-3" aria-hidden />
                      复制
                    </button>
                  </div>
                  <pre className="max-h-52 overflow-auto rounded-[6px] bg-ink p-3 text-[11px] leading-5 text-white">
                    {dslText}
                  </pre>
                </div>
                <div className="space-y-3">
                  <ListBlock title="验证" items={candidate.validation.tests} />
                  <ListBlock title="通过标准" items={candidate.validation.passCriteria} />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={saveFactor}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[7px] bg-ink px-4 font-mono text-[11px] text-white"
                >
                  {savedId ? <CheckCircle2 className="size-4" aria-hidden /> : <PlusCircle className="size-4" aria-hidden />}
                  {savedId ? "已加入因子库" : "加入我的因子"}
                </button>
                <span className="font-mono text-[10px] text-ink-faint">
                  {result?.source === "ai" ? `${result.provider ?? "default"} / ${result.model ?? "model"}` : "heuristic fallback"}
                </span>
                {savedId && (
                  <Link href="/factors" className="h-9 rounded-[7px] border border-rule bg-white px-3 py-2 font-mono text-[11px] text-ink-muted hover:text-ink">
                    查看因子资产库
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function InfoBlock({ title, value, mono }: { title: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-[7px] border border-rule bg-white px-3 py-3">
      <p className="font-mono text-[10px] text-ink-faint">{title}</p>
      <p className={`mt-2 whitespace-pre-wrap text-[12px] leading-5 text-ink-muted ${mono ? "font-mono" : ""}`}>
        {value}
      </p>
    </div>
  )
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-[7px] border border-rule bg-white px-3 py-3">
      <p className="font-mono text-[10px] text-ink-faint">{title}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <span key={item} className="rounded-[5px] border border-rule bg-[#fafafa] px-2 py-1 font-mono text-[10px] text-ink-muted">
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}
