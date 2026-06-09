"use client"

import { useMemo, useState } from "react"
import { Bot, KeyRound, Loader2, Send, Settings2 } from "lucide-react"
import type { DefaultModelRuntime, ProviderId } from "@/lib/model-providers"

type ProviderPreset = {
  id: ProviderId
  label: string
  baseUrl: string
  model: string
  keyHint: string
}

const PROVIDERS: ProviderPreset[] = [
  {
    id: "default",
    label: "默认模型",
    baseUrl: "",
    model: "",
    keyHint: "平台内置",
  },
  {
    id: "kimi",
    label: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k",
    keyHint: "KIMI_API_KEY",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    keyHint: "OPENAI_API_KEY",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-v4-flash",
    keyHint: "DEEPSEEK_API_KEY",
  },
  {
    id: "qwen",
    label: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    keyHint: "QWEN_API_KEY",
  },
  {
    id: "custom",
    label: "自定义",
    baseUrl: "",
    model: "",
    keyHint: "MODEL_API_KEY",
  },
]

type ChatResponse = {
  provider: ProviderId
  baseUrl: string
  model: string
  content: string
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  } | null
}

export function AssistantClient({
  examples,
  compact = false,
  defaultModel,
}: {
  examples: string[]
  compact?: boolean
  defaultModel?: DefaultModelRuntime
}) {
  const initialProvider = defaultModel?.provider ?? "default"
  const initialPreset = PROVIDERS.find((p) => p.id === initialProvider) ?? PROVIDERS[0]
  const [provider, setProvider] = useState<ProviderId>(initialProvider)
  const preset = useMemo(() => PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0], [provider])
  const [baseUrl, setBaseUrl] = useState(defaultModel?.baseUrl ?? initialPreset.baseUrl)
  const [model, setModel] = useState(defaultModel?.model ?? initialPreset.model)
  const [apiKey, setApiKey] = useState("")
  const [prompt, setPrompt] = useState(examples[0] ?? "")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ChatResponse | null>(null)

  function selectProvider(next: ProviderId) {
    const nextPreset = PROVIDERS.find((p) => p.id === next) ?? PROVIDERS[0]
    setProvider(next)
    setBaseUrl(nextPreset.baseUrl)
    setModel(nextPreset.model)
    setError(null)
  }

  async function submit() {
    const trimmed = prompt.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          baseUrl: baseUrl.trim() || undefined,
          model: model.trim() || undefined,
          apiKey: apiKey.trim() || undefined,
          prompt: trimmed,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }
      setResult(json as ChatResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : "模型调用失败")
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className={`${compact ? "" : "mt-5"} min-w-0 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5`}>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <Bot className="size-4" aria-hidden />
            模型 API
          </div>
          <p className="mt-2 text-[13px] leading-5 text-ink-muted">
            支持 OpenAI-compatible 接口。API Key 只用于本次服务端请求，不会写入代码或本地文件。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {PROVIDERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => selectProvider(item.id)}
              className={`h-8 rounded-[6px] border px-3 font-mono text-[11px] ${
                provider === item.id ? "border-ink bg-ink text-white" : "border-rule bg-[#fafafa] text-ink-muted"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr]">
        <Field label="Base URL" icon={Settings2}>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.example.com/v1"
            className="h-10 w-full rounded-[7px] border border-rule bg-[#fafafa] px-3 font-mono text-[12px] text-ink focus:border-ink focus:outline-none"
          />
        </Field>
        <Field label="Model" icon={Settings2}>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="moonshot-v1-8k"
            className="h-10 w-full rounded-[7px] border border-rule bg-[#fafafa] px-3 font-mono text-[12px] text-ink focus:border-ink focus:outline-none"
          />
        </Field>
        <div className="md:col-span-2">
          <Field
            label={`API Key（可留空，改用服务端 ${
              provider === defaultModel?.provider ? defaultModel.keyHint : preset.keyHint
            }）`}
            icon={KeyRound}
          >
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              type="password"
              placeholder="sk-..."
              autoComplete="off"
              className="h-10 w-full rounded-[7px] border border-rule bg-[#fafafa] px-3 font-mono text-[12px] text-ink focus:border-ink focus:outline-none"
            />
          </Field>
        </div>
      </div>

      <div className="mt-4 rounded-[7px] border border-rule bg-[#fafafa] p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[11px] text-ink-muted">对话区</p>
          <span className="font-mono text-[11px] text-ink-faint">
            {(provider === defaultModel?.provider ? "环境变量默认" : preset.label)} · {model || "未选择模型"}
          </span>
        </div>
        <textarea
          rows={5}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="例如：找出最近三天放量突破年线、且北向加仓的票，按市值降序排列..."
          className="mt-3 w-full resize-y rounded-[7px] border border-rule bg-white p-3 text-[15px] leading-6 text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none"
        />

        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">
            {examples.slice(0, 3).map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setPrompt(q)}
              className="rounded-[6px] border border-rule bg-white px-2.5 py-1.5 text-left text-[12px] text-ink-muted hover:text-ink"
              >
                {q}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={loading || !prompt.trim()}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-[7px] bg-ink px-4 font-mono text-[12px] text-white disabled:opacity-40"
          >
            {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
            {loading ? "分析中" : "开始分析"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-[7px] border border-bull/40 bg-bull/5 px-4 py-3 text-[13px] leading-5 text-bull">
          {error}
        </div>
      )}

      {result && (
        <article className="mt-4 rounded-[7px] border border-rule bg-[#fafafa] px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule-soft pb-3">
            <h2 className="text-[18px] font-semibold text-ink">模型分析结果</h2>
            <span className="font-mono text-[11px] text-ink-muted">
              {result.model}
              {result.usage?.total_tokens ? ` · ${result.usage.total_tokens} tokens` : ""}
            </span>
          </div>
          <div className="mt-4 whitespace-pre-wrap break-words text-[14px] leading-7 text-ink">{result.content}</div>
        </article>
      )}
    </section>
  )
}

function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-2 flex items-center gap-1.5 font-mono text-[11px] text-ink-muted">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </span>
      {children}
    </label>
  )
}
