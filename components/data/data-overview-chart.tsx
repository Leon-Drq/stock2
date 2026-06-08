"use client"

import { useState } from "react"
import type { HealthReport } from "@/lib/data-health"
import { DataSourceGrid } from "@/components/data/data-source-grid"
import { NightingaleRose } from "@/components/data/nightingale-rose"
import { QualityScatter } from "@/components/data/quality-scatter"

type View = "grid" | "rose" | "scatter"

const VIEWS: Array<{ id: View; label: string; hint: string }> = [
  { id: "grid", label: "卡片网格", hint: "12 张迷你卡 · 最高密度" },
  { id: "rose", label: "玫瑰图", hint: "径向编码 · 成功率全景" },
  { id: "scatter", label: "象限图", hint: "延迟 × 成功率 · 取舍象限" },
]

export function DataOverviewChart({ report }: { report: HealthReport }) {
  const [view, setView] = useState<View>("grid")

  if (!report.apiKeyConfigured) return null

  return (
    <section aria-labelledby="data-overview-heading" className="mt-5">
      <div className="no-scrollbar flex items-center gap-1 overflow-x-auto rounded-[7px] border border-rule bg-white p-1">
        {VIEWS.map((v) => {
          const active = view === v.id
          return (
            <button
              key={v.id}
              type="button"
              onClick={() => setView(v.id)}
              className={`shrink-0 rounded-[6px] px-3 py-2 text-[13px] transition-colors sm:px-4 ${
                active ? "bg-ink text-white" : "text-ink-muted hover:bg-[#fafafa] hover:text-ink"
              }`}
            >
              <span className={active ? "font-semibold" : ""}>{v.label}</span>
              <span className={`ml-1.5 hidden font-mono text-[10px] sm:inline ${active ? "text-white/60" : "text-ink-faint"}`}>
                {v.hint}
              </span>
            </button>
          )
        })}
      </div>

      {/* 内容 */}
      {view === "grid" && <DataSourceGrid report={report} />}

      {view === "rose" && (
        <figure className="mt-5 rounded-[7px] border border-rule bg-white p-5 sm:p-7">
          <NightingaleRose report={report} />
          <figcaption className="mt-5 border-t border-rule-soft pt-4 font-sans text-[12px] leading-relaxed text-ink-muted">
            <span className="font-semibold text-ink">玫瑰图</span>
            ——每瓣对应一个细分源，瓣长 = 平均成功率，颜色 = 健康状态。外圈数字为成功率 %，类目弧标注分组。
          </figcaption>
        </figure>
      )}

      {view === "scatter" && (
        <figure className="mt-5 rounded-[7px] border border-rule bg-white p-5 sm:p-7">
          <QualityScatter report={report} />
          <figcaption className="mt-5 border-t border-rule-soft pt-4 font-sans text-[12px] leading-relaxed text-ink-muted">
            <span className="font-semibold text-ink">象限图</span>
            ——理想源位于左上「快且稳」。右上「稳但慢」适合 T+1
            及周期型策略；左下「不可靠」不宜用于实时信号；右下需排查 Qveris 通道。
          </figcaption>
        </figure>
      )}
    </section>
  )
}
