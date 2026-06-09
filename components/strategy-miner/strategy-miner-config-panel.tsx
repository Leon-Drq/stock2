"use client"

import { useMemo, useState, useTransition } from "react"
import { Play, RotateCcw, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { StrategyMinerConfig } from "@/lib/strategy-miner-config"

type ConfigResponse = {
  ok: boolean
  config?: StrategyMinerConfig
  defaults?: StrategyMinerConfig
  persisted?: boolean
  error?: string
}

type RunResponse = {
  ok: boolean
  generatedAt?: string
  summary?: {
    sources: number
    candidates: number
    backtested: number
    promoted: number
    watchlist: number
    rejected: number
    github: number
    curated: number
  }
  error?: string
}

export function StrategyMinerConfigPanel({
  initialConfig,
  defaults,
}: {
  initialConfig: StrategyMinerConfig
  defaults: StrategyMinerConfig
}) {
  const [config, setConfig] = useState(initialConfig)
  const [queryText, setQueryText] = useState(initialConfig.queries.join("\n"))
  const [message, setMessage] = useState("当前配置来自后台环境变量和已保存配置。")
  const [isPending, startTransition] = useTransition()

  const normalizedConfig = useMemo<StrategyMinerConfig>(() => ({
    ...config,
    maxCandidates: clamp(config.maxCandidates, 4, 30),
    githubLimitPerQuery: clamp(config.githubLimitPerQuery, 1, 8),
    immediateBacktestLimit: clamp(config.immediateBacktestLimit, 0, config.maxCandidates),
    queries: queryText
      .split(/\r?\n/)
      .map((item) => item.trim().replace(/\s+/g, " "))
      .filter(Boolean)
      .slice(0, 12),
  }), [config, queryText])

  function updateNumber(key: "githubLimitPerQuery" | "maxCandidates" | "immediateBacktestLimit", value: string) {
    const parsed = Number(value)
    setConfig((current) => ({ ...current, [key]: Number.isFinite(parsed) ? parsed : current[key] }))
  }

  function saveConfig() {
    startTransition(async () => {
      const response = await fetch("/api/strategy-miner/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizedConfig),
      })
      const body = await response.json() as ConfigResponse
      if (!response.ok || !body.ok || !body.config) {
        setMessage(body.error || "保存失败。")
        return
      }
      setConfig(body.config)
      setQueryText(body.config.queries.join("\n"))
      setMessage(body.persisted ? "配置已保存到 Postgres。" : "配置已保存到进程缓存，Postgres 当前不可写。")
    })
  }

  function resetDefaults() {
    setConfig(defaults)
    setQueryText(defaults.queries.join("\n"))
    setMessage("已恢复为默认配置，点击保存后生效。")
  }

  function runNow() {
    startTransition(async () => {
      await fetch("/api/strategy-miner/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(normalizedConfig),
      })
      const response = await fetch("/api/strategy-miner/config/run", { method: "POST" })
      const body = await response.json() as RunResponse
      if (!response.ok || !body.ok || !body.summary) {
        setMessage(body.error || "立即运行失败。")
        return
      }
      setMessage(`已触发策略矿工：候选 ${body.summary.candidates}，已回测 ${body.summary.backtested}，晋级 ${body.summary.promoted}。`)
    })
  }

  return (
    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] text-ink-muted">strategy miner settings</p>
            <h2 className="mt-2 text-[18px] font-semibold text-ink">挖掘源与回测参数</h2>
            <p className="mt-1 max-w-[760px] text-[13px] leading-5 text-ink-muted">
              配置保存后，策略研究页、定时任务和手动刷新都会使用同一套参数。
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2">
            <span className="text-[12px] text-ink-muted">GitHub 搜索</span>
            <Switch
              checked={config.githubEnabled}
              onCheckedChange={(checked) => setConfig((current) => ({ ...current, githubEnabled: checked }))}
              aria-label="GitHub 搜索"
            />
          </div>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <NumberField
            label="每个搜索词仓库数"
            min={1}
            max={8}
            value={config.githubLimitPerQuery}
            onChange={(value) => updateNumber("githubLimitPerQuery", value)}
          />
          <NumberField
            label="每轮候选上限"
            min={4}
            max={30}
            value={config.maxCandidates}
            onChange={(value) => updateNumber("maxCandidates", value)}
          />
          <NumberField
            label="即时回测数量"
            min={0}
            max={config.maxCandidates}
            value={config.immediateBacktestLimit}
            onChange={(value) => updateNumber("immediateBacktestLimit", value)}
          />
        </div>

        <label className="mt-5 block">
          <span className="text-[13px] font-semibold text-ink">GitHub 搜索词</span>
          <Textarea
            className="mt-2 min-h-[220px] resize-y bg-[#fafafa] font-mono text-[12px]"
            value={queryText}
            onChange={(event) => setQueryText(event.target.value)}
            spellCheck={false}
          />
        </label>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button type="button" onClick={saveConfig} disabled={isPending}>
            <Save className="size-4" aria-hidden />
            保存配置
          </Button>
          <Button type="button" variant="outline" onClick={runNow} disabled={isPending}>
            <Play className="size-4" aria-hidden />
            立即运行
          </Button>
          <Button type="button" variant="ghost" onClick={resetDefaults} disabled={isPending}>
            <RotateCcw className="size-4" aria-hidden />
            恢复默认
          </Button>
        </div>
        <p className="mt-3 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 text-[12px] leading-5 text-ink-muted">
          {isPending ? "正在处理..." : message}
        </p>
      </section>

      <aside className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <p className="font-mono text-[11px] text-ink-muted">runtime preview</p>
        <h2 className="mt-2 text-[18px] font-semibold text-ink">当前生效预览</h2>
        <div className="mt-4 grid gap-2">
          <PreviewRow label="GitHub 搜索" value={normalizedConfig.githubEnabled ? "启用" : "关闭"} />
          <PreviewRow label="搜索词数量" value={`${normalizedConfig.queries.length}`} />
          <PreviewRow label="每词仓库数" value={`${normalizedConfig.githubLimitPerQuery}`} />
          <PreviewRow label="候选上限" value={`${normalizedConfig.maxCandidates}`} />
          <PreviewRow label="即时回测" value={`${normalizedConfig.immediateBacktestLimit}`} />
        </div>
        <p className="mt-4 text-[12px] leading-5 text-ink-muted">
          环境变量 `STRATEGY_MINER_DISABLE_GITHUB=1` 会强制关闭 GitHub 搜索，即使这里保存为启用也不会访问 GitHub。
        </p>
      </aside>
    </div>
  )
}

function NumberField({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string
  min: number
  max: number
  value: number
  onChange: (value: string) => void
}) {
  return (
    <label className="block">
      <span className="text-[13px] font-semibold text-ink">{label}</span>
      <Input
        className="mt-2 bg-[#fafafa] font-mono"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <span className="mt-1 block font-mono text-[10px] text-ink-faint">范围 {min}-{max}</span>
    </label>
  )
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2">
      <span className="text-[12px] text-ink-muted">{label}</span>
      <span className="font-mono text-[12px] text-ink">{value}</span>
    </div>
  )
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(Math.trunc(value), max))
}
