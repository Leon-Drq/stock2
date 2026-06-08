import type { TrackRecord as TrackRecordType } from "@/lib/radar-data"
import { SectionLabel } from "./conclusion"

type TrackRecordProps = {
  trackRecord: TrackRecordType
}

export function TrackRecord({ trackRecord }: TrackRecordProps) {
  const {
    windowDays,
    totalSignals,
    hitRate,
    avgAlphaT1,
    avgAlphaT5,
    benchmarkName,
    benchmarkReturnPct,
    topAlpha,
  } = trackRecord

  const hitPct = Math.round(hitRate * 100)

  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="flex items-baseline justify-between gap-4">
        <SectionLabel>历史复盘</SectionLabel>
        <span className="font-mono text-[11px] text-ink-muted">
          过去 {windowDays} 天 · vs {benchmarkName}
        </span>
      </div>

      <div className="mt-4 rounded-[7px] border border-rule bg-[#fafafa] px-4 py-4">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <span className="font-mono text-4xl font-medium leading-none tabular text-ink md:text-5xl">
            {hitPct}
            <span className="text-lg text-ink-muted md:text-xl">%</span>
          </span>
          <span className="font-mono text-[11px] text-ink-muted">
            命中率 · <span className="tabular">{totalSignals}</span> 条已结算
          </span>

          {topAlpha && (
            <span className="ml-auto inline-flex items-baseline gap-2 text-[14px] text-ink-soft">
              <span className="font-mono text-[11px] text-ink-muted">
                最佳
              </span>
              <span className="font-mono text-xl tabular text-bull">
                +{topAlpha.alphaPct.toFixed(2)}%
              </span>
              <span>{topAlpha.name}</span>
              <span className="font-mono text-xs text-ink-muted">{topAlpha.ticker}</span>
              <span className="font-mono text-[10px] text-ink-faint">
                {topAlpha.horizon}
              </span>
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-rule-soft pt-3 font-mono text-[11px] text-ink-muted">
          <AlphaInline label="T+1 超额" value={avgAlphaT1} />
          <AlphaInline label="T+5 超额" value={avgAlphaT5} />
          <span>
            {benchmarkName}{" "}
            <span className="ml-1 text-base tabular text-ink-soft">
              {benchmarkReturnPct >= 0 ? "+" : ""}
              {benchmarkReturnPct.toFixed(1)}%
            </span>
          </span>
        </div>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
        命中按 T+5 个股收益为正且跑赢基准计；平均超额取算术平均；未到期信号不计入。
      </p>
    </section>
  )
}

function AlphaInline({ label, value }: { label: string; value: number | null }) {
  const color =
    value === null || value === 0
      ? "text-ink"
      : value > 0
        ? "text-bull"
        : "text-bear"
  return (
    <span>
      {label}{" "}
      <span className={`ml-1 text-base tabular ${color}`}>
        {value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`}
      </span>
    </span>
  )
}
