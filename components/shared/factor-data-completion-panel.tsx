"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, CheckCircle2, Clipboard, Database, Search, ServerCog } from "lucide-react"
import type { FactorDataBinding, FactorDataPlan, FactorDataStatus } from "@/lib/factor-data-bindings"

type DiscoverState = {
  loading?: boolean
  error?: string
  tools?: Array<{ tool_id: string; name: string; provider_name?: string; description?: string }>
}

const STATUS_LABEL: Record<FactorDataStatus, string> = {
  real: "真实可算",
  proxy: "K线代理",
  missing: "待绑定",
}

const STATUS_CLASS: Record<FactorDataStatus, string> = {
  real: "text-health-ok bg-health-ok/10 border-health-ok/20",
  proxy: "text-warning bg-warning/10 border-warning/20",
  missing: "text-bear bg-bear/10 border-bear/20",
}

export function FactorDataCompletionPanel({
  plan,
  title = "因子数据补齐",
  subtitle,
}: {
  plan: FactorDataPlan
  title?: string
  subtitle?: string
}) {
  const [discoveries, setDiscoveries] = useState<Record<string, DiscoverState>>({})
  const needsBinding = plan.proxyCount + plan.missingCount
  const headline = useMemo(() => {
    if (needsBinding === 0) return "当前策略因子均可由 Qveris 原始字段或 K 线公式直接计算。"
    return `${needsBinding}/${plan.total} 个因子还需要补齐真实字段，当前回测结果只能作为代理验证。`
  }, [needsBinding, plan.total])

  async function discoverBinding(binding: FactorDataBinding) {
    setDiscoveries((current) => ({ ...current, [binding.factorId]: { loading: true } }))
    try {
      const res = await fetch("/api/qveris/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: binding.qverisQuery, limit: 5 }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setDiscoveries((current) => ({
        ...current,
        [binding.factorId]: { tools: Array.isArray(json.results) ? json.results.slice(0, 3) : [] },
      }))
    } catch (error) {
      setDiscoveries((current) => ({
        ...current,
        [binding.factorId]: { error: error instanceof Error ? error.message : "Qveris discover 失败" },
      }))
    }
  }

  async function copyQuery(binding: FactorDataBinding) {
    await navigator.clipboard.writeText(binding.qverisQuery)
  }

  return (
    <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <Database className="size-4" aria-hidden />
            data completion
          </div>
          <h3 className="mt-2 text-[18px] font-semibold text-ink">{title}</h3>
          <p className="mt-1 max-w-[760px] text-[13px] leading-6 text-ink-muted">
            {subtitle ?? headline}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Kpi label="真实" value={plan.realCount} tone="good" />
          <Kpi label="代理" value={plan.proxyCount} tone="warning" />
          <Kpi label="缺失" value={plan.missingCount} tone="bad" />
        </div>
      </div>

      <div className="mt-4 grid gap-2 xl:grid-cols-2">
        {plan.bindings.map((binding) => (
          <BindingRow
            key={binding.factorId}
            binding={binding}
            discover={discoveries[binding.factorId]}
            onDiscover={() => discoverBinding(binding)}
            onCopy={() => copyQuery(binding)}
          />
        ))}
      </div>

      <div className="mt-4 grid gap-2 lg:grid-cols-3">
        {plan.storagePlan.map((item) => (
          <div key={item.table} className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
            <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
              <ServerCog className="size-4" aria-hidden />
              {item.table}
            </div>
            <p className="mt-2 text-[12px] leading-5 text-ink-muted">{item.purpose}</p>
            <p className="mt-2 font-mono text-[10px] leading-4 text-ink-faint">{item.key} · {item.ttl}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function BindingRow({
  binding,
  discover,
  onDiscover,
  onCopy,
}: {
  binding: FactorDataBinding
  discover?: DiscoverState
  onDiscover: () => void
  onCopy: () => void
}) {
  const canDiscover = binding.status !== "real" && Boolean(binding.qverisQuery)
  return (
    <article className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] text-ink-faint">{binding.factorId}</span>
            <span className={`rounded-[5px] border px-1.5 py-0.5 font-mono text-[10px] ${STATUS_CLASS[binding.status]}`}>
              {STATUS_LABEL[binding.status]}
            </span>
          </div>
          <h4 className="mt-1 text-[15px] font-semibold text-ink">{binding.factorName}</h4>
          <p className="mt-1 font-mono text-[10px] leading-4 text-ink-muted">{binding.formula}</p>
        </div>
        {binding.status === "real" ? (
          <CheckCircle2 className="size-5 shrink-0 text-health-ok" aria-hidden />
        ) : (
          <AlertTriangle className="size-5 shrink-0 text-warning" aria-hidden />
        )}
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Mini label="实现" value={binding.currentImplementation} />
        <Mini label="数据源" value={binding.sourceNames.length ? binding.sourceNames.join(" / ") : "待确认"} />
        <Mini label="字段" value={binding.requiredFields.length ? binding.requiredFields.join(", ") : "待确认"} />
      </div>

      <p className="mt-3 rounded-[6px] border border-rule bg-white px-2 py-2 text-[12px] leading-5 text-ink-muted">
        {binding.nextAction}
      </p>

      {canDiscover && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onDiscover}
            disabled={discover?.loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-ink px-3 font-mono text-[11px] text-white disabled:opacity-50"
          >
            <Search className="size-3.5" aria-hidden />
            {discover?.loading ? "探测中" : "探测 Qveris 工具"}
          </button>
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex h-8 items-center gap-1.5 rounded-[6px] border border-rule bg-white px-3 font-mono text-[11px] text-ink-muted"
          >
            <Clipboard className="size-3.5" aria-hidden />
            复制查询
          </button>
        </div>
      )}

      {discover?.error && (
        <p className="mt-2 rounded-[6px] border border-bear/20 bg-bear/5 px-2 py-2 text-[12px] leading-5 text-bear">
          {discover.error}
        </p>
      )}
      {discover?.tools && (
        <div className="mt-2 space-y-1.5">
          {discover.tools.length ? discover.tools.map((tool) => (
            <div key={tool.tool_id} className="rounded-[6px] border border-rule bg-white px-2 py-2">
              <p className="truncate text-[12px] font-medium text-ink">{tool.name}</p>
              <p className="mt-0.5 font-mono text-[10px] text-ink-faint">{tool.provider_name ?? "Qveris"} · {tool.tool_id}</p>
            </div>
          )) : (
            <p className="rounded-[6px] border border-rule bg-white px-2 py-2 text-[12px] text-ink-muted">Qveris 暂无匹配工具。</p>
          )}
        </div>
      )}
    </article>
  )
}

function Kpi({ label, value, tone }: { label: string; value: number; tone: "good" | "warning" | "bad" }) {
  const color = tone === "good" ? "text-health-ok" : tone === "warning" ? "text-warning" : "text-bear"
  return (
    <div className="min-w-[70px] rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2">
      <p className="font-mono text-[10px] text-ink-muted">{label}</p>
      <p className={`mt-1 font-mono text-[20px] font-semibold leading-none ${color}`}>{value}</p>
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[6px] border border-rule bg-white px-2 py-2">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className="mt-1 line-clamp-2 text-[12px] leading-4 text-ink-muted">{value}</p>
    </div>
  )
}
