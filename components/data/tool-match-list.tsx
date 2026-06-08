import type { DataSourceHealth } from "@/lib/data-health"

function pct(v: number | null): string {
  if (v == null) return "—"
  return `${(v * 100).toFixed(0)}%`
}

function ms(v: number | null): string {
  if (v == null) return "—"
  if (v < 1000) return `${v} ms`
  return `${(v / 1000).toFixed(1)} s`
}

export function ToolMatchList({ health }: { health: DataSourceHealth }) {
  if (health.error) {
    return (
      <div className="mt-4 border-l-2 border-health-bad/40 bg-health-bad/5 px-3 py-2">
        <p className="font-mono text-[10px] uppercase tracking-wider text-health-bad">采样失败</p>
        <p className="mt-1 font-mono text-[11px] text-ink-soft">{health.error}</p>
      </div>
    )
  }

  if (health.topTools.length === 0) {
    return (
      <div className="mt-4 border-l-2 border-rule pl-3">
        <p className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          Qveris 暂未匹配到工具
        </p>
      </div>
    )
  }

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-baseline gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
          Qveris 匹配 · 共 {health.toolCount} 个 · 平均成功率 {pct(health.avgSuccessRate)} · 平均延迟 {ms(health.avgLatencyMs)}
        </p>
      </div>
      <ul className="border-l border-rule">
        {health.topTools.map((t) => (
          <li key={t.tool_id} className="border-b border-rule-soft pl-3 last:border-b-0">
            <div className="flex items-baseline justify-between gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[14px] font-medium text-ink">{t.name}</p>
                <p className="mt-0.5 truncate font-mono text-[10px] text-ink-muted">
                  {t.tool_id}
                  {t.provider_name ? ` · ${t.provider_name}` : ""}
                  {t.region ? ` · ${t.region}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 gap-3 font-mono text-[10px] tabular-nums text-ink-soft">
                <span title="成功率">{pct(t.stats?.success_rate ?? null)}</span>
                <span className="text-ink-faint">·</span>
                <span title="平均延迟">{ms(t.stats?.avg_execution_time_ms ?? null)}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
