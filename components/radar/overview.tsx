import { CircleAlert, Layers3, ShieldCheck } from "lucide-react"
import type { RadarReport, SignalLevel } from "@/lib/radar-data"
import { signalLevelLabel } from "@/lib/radar-data"
import { SectionLabel } from "./conclusion"

const SIGNAL_ORDER: SignalLevel[] = ["green", "yellow", "blue", "compass", "purple", "orange", "red"]

const SIGNAL_COLOR_CLASS: Record<SignalLevel, string> = {
  green: "bg-[var(--signal-green)]",
  yellow: "bg-[var(--signal-yellow)]",
  blue: "bg-[var(--signal-blue)]",
  compass: "bg-[var(--neutral)]",
  purple: "bg-[var(--signal-purple)]",
  orange: "bg-[var(--signal-orange)]",
  red: "bg-[var(--signal-red)]",
}

type OverviewProps = {
  overview: RadarReport["overview"]
  compact?: boolean
}

export function Overview({ overview, compact = false }: OverviewProps) {
  const total = SIGNAL_ORDER.reduce((sum, k) => sum + overview.signals[k], 0)

  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="flex items-baseline justify-between gap-4">
        <SectionLabel>雷达总览</SectionLabel>
        <span className="font-mono text-[11px] text-ink-muted">
          {total} 条信号
        </span>
      </div>

      <div className={`mt-4 grid gap-2 ${compact ? "md:grid-cols-3 2xl:grid-cols-1" : "md:grid-cols-3"}`}>
        <Metric icon={ShieldCheck} label="质量分" value={`${overview.qualityScore}/100`} note={overview.qualityNote} />
        <Metric icon={Layers3} label="动作级信号" value={String(overview.actionSignalCount)} note={`${overview.cleanups} 个清扫`} />
        <Metric icon={CircleAlert} label="数据检查" value={String(overview.freshnessIssues + overview.runtimeErrors)} note="异常项" />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-[12px]">
        {SIGNAL_ORDER.map((level) => {
          const count = overview.signals[level]
          const dimmed = count === 0
          return (
            <span
              key={level}
              className={`inline-flex h-8 items-center gap-2 rounded-[7px] border border-rule px-2.5 ${
                dimmed ? "bg-[#fafafa] text-ink-faint" : "bg-white text-ink-soft"
              }`}
              title={signalLevelLabel[level]}
            >
              <span
                className={`size-2 rounded-full ${SIGNAL_COLOR_CLASS[level]}`}
                aria-hidden
              />
              <span>{signalLevelLabel[level]}</span>
              <span className="font-mono tabular">{count}</span>
            </span>
          )
        })}
      </div>

      {overview.pools.length > 0 && (
        <ul className="mt-4 space-y-2">
          {overview.pools.map((p) => (
            <li key={p.name} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[7px] bg-[#fafafa] px-3 py-2 text-[12px] text-ink-muted">
              <span className="font-mono text-[11px] text-ink-soft">{p.name}</span>
              <span className="font-mono tabular text-ink">{p.count}</span>
              {p.cap !== undefined && (
                <span className="font-mono tabular">/ 上限 {p.cap}</span>
              )}
              {p.note && <span>{p.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>
  label: string
  value: string
  note: string
}) {
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <div className="flex items-center gap-2 text-[12px] text-ink-muted">
        <Icon className="size-4" aria-hidden />
        <span>{label}</span>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="font-mono text-[22px] leading-none text-ink tabular">{value}</span>
        <span className="text-[12px] text-ink-muted">{note}</span>
      </div>
    </div>
  )
}
