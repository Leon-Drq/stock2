import type { HealthStatus } from "@/lib/data-health"

const META: Record<HealthStatus, { label: string; dot: string; text: string }> = {
  healthy: { label: "正常", dot: "bg-health-ok", text: "text-health-ok" },
  degraded: { label: "降级", dot: "bg-health-warn", text: "text-health-warn" },
  down: { label: "中断", dot: "bg-health-bad", text: "text-health-bad" },
  "rate-limited": { label: "限速", dot: "bg-health-warn", text: "text-health-warn" },
  unknown: { label: "未知", dot: "bg-health-mute", text: "text-health-mute" },
}

export function HealthBadge({ status }: { status: HealthStatus }) {
  const m = META[status]
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${m.text}`}>
      <span className={`size-1.5 rounded-full ${m.dot}`} aria-hidden />
      {m.label}
    </span>
  )
}
