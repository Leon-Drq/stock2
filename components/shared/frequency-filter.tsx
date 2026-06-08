"use client"

import { useState } from "react"

export const FREQUENCIES = [
  { id: "all", label: "全部", desc: "" },
  { id: "intraday", label: "日内", desc: "T+0 模拟 / 分钟级" },
  { id: "swing", label: "波段", desc: "2-10 个交易日" },
  { id: "position", label: "周期", desc: "数周至数月" },
  { id: "hf", label: "高频", desc: "Tick / 秒级" },
] as const

export type FrequencyId = (typeof FREQUENCIES)[number]["id"]

export function FrequencyFilter({
  value,
  onChange,
}: {
  value: FrequencyId
  onChange: (v: FrequencyId) => void
}) {
  return (
    <div className="no-scrollbar flex items-center gap-1 overflow-x-auto rounded-[7px] border border-rule bg-white px-3 py-3">
      <span className="shrink-0 pr-2 font-mono text-[11px] text-ink-muted">
        频率
      </span>
      {FREQUENCIES.map((f) => {
        const active = value === f.id
        return (
          <button
            key={f.id}
            onClick={() => onChange(f.id)}
            className={`h-8 shrink-0 rounded-[6px] border px-3 text-[12px] transition-colors ${
              active
                ? "border-ink bg-ink text-paper"
                : "border-rule bg-transparent text-ink-soft hover:border-ink hover:text-ink"
            }`}
          >
            {f.label}
            {f.desc && (
              <span
                className={`ml-1.5 hidden font-mono text-[10px] sm:inline ${
                  active ? "text-paper/60" : "text-ink-faint"
                }`}
              >
                {f.desc}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// Stateful wrapper for pages that don't need URL sync
export function useFrequency(initial: FrequencyId = "all") {
  return useState<FrequencyId>(initial)
}
