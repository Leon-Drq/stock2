"use client"

import { useEffect, useState, useMemo } from "react"
import Link from "next/link"
import type { Factor } from "@/lib/catalog"
import { FrequencyFilter, type FrequencyId } from "@/components/shared/frequency-filter"
import { FactorDetailPanel } from "@/components/factors/factor-detail-panel"
import { loadCustomFactors, mergeFactors, removeCustomFactor, type CustomFactor } from "@/lib/custom-factors"
import {
  buildFactorAssets,
  factorAssetSummary,
  factorStatusClass,
  type FactorAsset,
  type FactorAssetStatus,
  LIVE_FACTOR_IDS,
} from "@/lib/factor-assets"

const CATEGORIES: (Factor["category"] | "全部")[] = ["全部", "动量", "反转", "量价", "资金", "情绪", "基本面", "AI"]
const STATUS_FILTERS: Array<{ id: FactorAssetStatus | "全部"; label: string }> = [
  { id: "全部", label: "全部状态" },
  { id: "validated", label: "已验证" },
  { id: "watchlist", label: "观察中" },
  { id: "data-gap", label: "数据待补" },
  { id: "duplicate", label: "高相关重复" },
  { id: "deprecated", label: "暂不使用" },
]

export function FactorsClient({ factors }: { factors: Factor[] }) {
  const [freq, setFreq] = useState<FrequencyId>("all")
  const [cat, setCat] = useState<Factor["category"] | "全部">("全部")
  const [sortBy, setSortBy] = useState<"ic" | "ir" | "win">("ic")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showLiveOnly, setShowLiveOnly] = useState(false)
  const [status, setStatus] = useState<FactorAssetStatus | "全部">("全部")
  const [customFactors, setCustomFactors] = useState<CustomFactor[]>([])

  function refreshCustomFactors() {
    setCustomFactors(loadCustomFactors())
  }

  useEffect(() => {
    const timer = window.setTimeout(refreshCustomFactors, 0)
    const onStorage = (event: StorageEvent) => {
      if (event.key === "stock-radar.custom-factors.v1") refreshCustomFactors()
    }
    window.addEventListener("storage", onStorage)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener("storage", onStorage)
    }
  }, [])

  const assets = useMemo(() => buildFactorAssets(mergeFactors(factors, customFactors)), [factors, customFactors])
  const summary = useMemo(() => factorAssetSummary(assets), [assets])

  const filtered = useMemo(() => {
    let list = assets
    if (freq !== "all" && freq !== "hf") {
      list = list.filter((asset) => asset.factor.freq === freq)
    }
    if (cat !== "全部") {
      list = list.filter((asset) => asset.factor.category === cat)
    }
    if (status !== "全部") {
      list = list.filter((asset) => asset.status === status)
    }
    if (showLiveOnly) {
      list = list.filter((asset) => asset.live)
    }
    return [...list].sort((a, b) => b.factor[sortBy] - a.factor[sortBy])
  }, [assets, freq, cat, status, sortBy, showLiveOnly])

  function deleteCustomFactor(id: string) {
    setCustomFactors(removeCustomFactor(id))
    if (expanded === id) setExpanded(null)
  }

  return (
    <>
      <div className="mt-5">
        <FrequencyFilter value={freq} onChange={setFreq} />
      </div>

      <section className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <AssetKpi label="因子资产" value={summary.total} sub="库内总量" />
        <AssetKpi label="已验证" value={summary.validated} sub="可入策略候选" good />
        <AssetKpi label="观察中" value={summary.watchlist} sub="继续滚动验证" />
        <AssetKpi label="数据待补" value={summary.dataGap} sub="非价格或字段缺口" warning />
        <AssetKpi label="我的因子" value={summary.custom} sub="来自实验台/文档" />
      </section>

      <section className="mt-3 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="font-mono text-[11px] text-ink-muted">factor pipeline</p>
            <h2 className="mt-2 text-[20px] font-semibold text-ink">因子库只保留验证资产</h2>
            <p className="mt-2 max-w-[80ch] text-[13px] leading-6 text-ink-muted">
              新想法、文档规则和自然语言假设先去因子实验台；通过字段映射、单因子 IC、分组收益、覆盖率和相关性检查后，再进入这里被策略调用。
            </p>
          </div>
          <Link
            href="/factor-lab"
            className="inline-flex h-10 shrink-0 items-center justify-center rounded-[7px] border border-ink bg-ink px-4 font-mono text-[11px] text-white hover:bg-white hover:text-ink"
          >
            进入因子实验台
          </Link>
        </div>
      </section>

      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-[7px] border border-rule bg-white px-3 py-3">
        <span className="font-mono text-[11px] text-ink-muted">
          分类
        </span>
        {CATEGORIES.map((c) => {
          const active = cat === c
          return (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`h-8 rounded-[6px] border px-3 text-[12px] transition-colors ${
                active
                  ? "border-ink bg-ink text-white"
                  : "border-rule bg-[#fafafa] text-ink-muted hover:text-ink"
              }`}
            >
              {c}
            </button>
          )
        })}
        <button
          onClick={() => setShowLiveOnly((v) => !v)}
          className={`inline-flex h-8 items-center gap-1.5 rounded-[6px] border px-3 font-mono text-[11px] transition-colors ${
            showLiveOnly
              ? "border-health-ok bg-health-ok/10 text-health-ok"
              : "border-rule text-ink-soft hover:text-ink"
          }`}
        >
          <span
            className={`size-1.5 rounded-full ${showLiveOnly ? "bg-health-ok" : "bg-ink-faint"}`}
            aria-hidden
          />
          仅实时可算 ({LIVE_FACTOR_IDS.size})
        </button>
        {STATUS_FILTERS.map((item) => {
          const active = status === item.id
          return (
            <button
              key={item.id}
              onClick={() => setStatus(item.id)}
              className={`h-8 rounded-[6px] border px-3 text-[12px] transition-colors ${
                active ? "border-ink bg-ink text-white" : "border-rule bg-[#fafafa] text-ink-muted hover:text-ink"
              }`}
            >
              {item.label}
            </button>
          )
        })}
        <span className="rounded-[6px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink-muted">
          我的因子 {customFactors.length}
        </span>
        <span className="ml-auto font-mono text-[11px] text-ink-muted">
          排序
        </span>
        {(["ic", "ir", "win"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            className={`h-8 rounded-[6px] border px-3 font-mono text-[11px] transition-colors ${
              sortBy === s ? "border-ink bg-ink text-white" : "border-rule bg-[#fafafa] text-ink-muted hover:text-ink"
            }`}
          >
            {s === "ic" ? "IC" : s === "ir" ? "IR" : "胜率"}
          </button>
        ))}
      </div>

      <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[18px] font-semibold text-ink">因子资产列表</h2>
          <p className="font-mono text-[11px] text-ink-muted">{filtered.length} 个因子</p>
        </div>
        <ul className="grid gap-2 2xl:grid-cols-2">
          {filtered.map((asset) => {
            const f = asset.factor
            const custom = isCustomFactor(f) ? f : null
            const isOpen = expanded === f.id
            return (
              <li key={f.id} className={`rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3 ${isOpen ? "2xl:col-span-2" : ""}`}>
                <button
                  onClick={() => setExpanded(isOpen ? null : f.id)}
                  className="group block w-full text-left"
                  aria-expanded={isOpen}
                >
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] text-ink-faint">
                          {f.category}
                        </span>
                        <h3 className="text-[18px] font-semibold text-ink group-hover:underline">
                          {f.name}
                        </h3>
                        <span className={`inline-flex items-center gap-1 rounded-[5px] border px-1.5 py-0.5 font-mono text-[9px] ${factorStatusClass(asset.status)}`}>
                          {asset.statusLabel}
                        </span>
                        {asset.live && (
                          <span className="inline-flex items-center gap-1 rounded-[5px] border border-health-ok/40 bg-health-ok/5 px-1.5 py-0.5 font-mono text-[9px] text-health-ok">
                            <span className="size-1 rounded-full bg-health-ok" aria-hidden />
                            可实时计算
                          </span>
                        )}
                        {custom && (
                          <span className="inline-flex items-center gap-1 rounded-[5px] border border-warning/40 bg-warning/5 px-1.5 py-0.5 font-mono text-[9px] text-warning">
                            用户生成 · {custom.status === "validated" ? "已验证" : "待回测"}
                          </span>
                        )}
                      </div>
                      <p className="mt-2 max-w-[70ch] font-mono text-[12px] leading-relaxed text-ink-muted">
                        {f.formula}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-[5px] border border-rule bg-white px-2 py-1 font-mono text-[10px] text-ink-muted">
                          score {asset.score}
                        </span>
                        <span className="rounded-[5px] border border-rule bg-white px-2 py-1 font-mono text-[10px] text-ink-muted">
                          {asset.usageLabel}
                        </span>
                        {asset.dataRequirements.map((item) => (
                          <span key={item} className="rounded-[5px] border border-rule bg-white px-2 py-1 font-mono text-[10px] text-ink-muted">
                            {item}
                          </span>
                        ))}
                      </div>
                      {custom && (
                        <p className="mt-2 max-w-[70ch] text-[12px] leading-5 text-ink-muted">
                          来自「{custom.strategyName}」：{custom.sourceText}
                        </p>
                      )}
                    </div>
                    <div className="flex w-full shrink-0 items-start justify-between gap-4 xl:w-auto">
                      <FactorStats factor={f} />
                      <span className="mt-1 font-mono text-[16px] text-ink-faint">
                        {isOpen ? "−" : "+"}
                      </span>
                    </div>
                  </div>
                </button>
                {custom && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-rule-soft pt-3">
                    {custom.dataRequirements.map((item) => (
                      <span key={item} className="rounded-[5px] border border-rule bg-white px-2 py-1 font-mono text-[10px] text-ink-muted">
                        {item}
                      </span>
                    ))}
                    <button
                      type="button"
                      onClick={() => deleteCustomFactor(custom.id)}
                      className="ml-auto h-7 rounded-[6px] border border-rule bg-white px-2 font-mono text-[10px] text-ink-muted hover:text-bear"
                    >
                      移除
                    </button>
                  </div>
                )}
                <FactorAssetNotes asset={asset} />
                {isOpen && <FactorDetailPanel factorId={f.id} />}
              </li>
            )
          })}
        </ul>
      </section>

      <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <p className="font-mono text-[11px] text-ink-muted">
          factor lab
        </p>
        <p className="mt-3 max-w-[60ch] text-[14px] leading-6 text-ink-muted">
          自然语言、PDF 策略和交易经验不要直接塞进因子库；先进入实验台生成 DSL、检查数据字段、跑单因子验证，再决定是否沉淀为资产。
        </p>
        <Link href="/factor-lab" className="mt-5 inline-flex h-9 items-center rounded-[7px] border border-ink bg-ink px-4 font-mono text-[11px] text-paper hover:bg-paper hover:text-ink">
          去因子实验台
        </Link>
      </section>
    </>
  )
}

function AssetKpi({
  label,
  value,
  sub,
  good,
  warning,
}: {
  label: string
  value: number
  sub: string
  good?: boolean
  warning?: boolean
}) {
  const tone = good ? "text-health-ok" : warning ? "text-warning" : "text-ink"
  return (
    <div className="rounded-[7px] border border-rule bg-white px-4 py-4">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className={`mt-2 font-mono text-[26px] font-semibold ${tone}`}>{value}</p>
      <p className="mt-1 text-[12px] text-ink-muted">{sub}</p>
    </div>
  )
}

function FactorAssetNotes({ asset }: { asset: FactorAsset }) {
  return (
    <div className="mt-3 grid gap-2 border-t border-rule-soft pt-3 md:grid-cols-2">
      {asset.notes.slice(0, 2).map((note) => (
        <p key={note} className="rounded-[6px] border border-rule bg-white px-2 py-2 text-[11px] leading-5 text-ink-muted">
          {note}
        </p>
      ))}
    </div>
  )
}

function isCustomFactor(factor: Factor | CustomFactor): factor is CustomFactor {
  return "source" in factor && factor.source === "user-generated"
}

function FactorStats({ factor }: { factor: Factor }) {
  const stats = [
    { label: "IC", value: factor.ic.toFixed(3) },
    { label: "IR", value: factor.ir.toFixed(2) },
    { label: "Q1-Q5", value: `+${factor.q1q5.toFixed(1)}%` },
    { label: "胜率", value: `${factor.win}%` },
  ]
  return (
    <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-4 md:gap-4">
      {stats.map((s) => (
        <div key={s.label} className="text-right">
          <p className="font-mono text-[9px] text-ink-faint">
            {s.label}
          </p>
          <p className="mt-1 font-mono text-[16px] tabular text-ink">{s.value}</p>
        </div>
      ))}
    </div>
  )
}
