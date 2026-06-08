import type { AttributionPoint } from "@/lib/radar-data"

type AttributionStripProps = {
  points: AttributionPoint[]
  benchmarkName?: string
}

/**
 * 单条信号下方的回测对账条带。
 *
 * 视觉锚点 = 朋友雷达截图最有说服力的部分："说了 → 真涨了"。
 * 排版上和报刊脚注一样：三列等分，小字密度，不抢主卡风头。
 */
export function AttributionStrip({ points, benchmarkName = "沪深 300" }: AttributionStripProps) {
  if (!points.length) return null

  return (
    <div className="mt-3 border-t border-rule-soft pt-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-muted">
        <span>对账</span>
        <span className="text-ink-faint">vs {benchmarkName}</span>
        <span className="ml-auto inline-flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {points.map((p) => (
            <Cell key={p.horizon} point={p} />
          ))}
        </span>
      </div>
    </div>
  )
}

/**
 * 单个时段的对账：T+N 个股 / α，pending 用 — 占位。
 * Inline 排版，三个 horizon 横向排列在右侧。
 */
function Cell({ point }: { point: AttributionPoint }) {
  const pending = point.stockReturnPct === null

  if (pending) {
    return (
      <span className="inline-flex items-baseline gap-1 text-ink-faint">
        <span>{point.horizon}</span>
        <span className="font-display text-sm normal-case tracking-normal tabular">—</span>
      </span>
    )
  }

  const stockReturn = point.stockReturnPct as number
  const alpha = point.alphaPct as number
  const stockColor = stockReturn >= 0 ? "text-bull" : "text-bear"
  const alphaColor = alpha >= 0 ? "text-bull" : "text-bear"
  const sign = (n: number) => (n >= 0 ? "+" : "")

  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="text-ink-muted">
        {point.horizon}
        {point.hit && <span className="ml-0.5 text-bull" aria-label="命中">●</span>}
      </span>
      <span className={`font-display text-sm normal-case tracking-normal tabular ${stockColor}`}>
        {sign(stockReturn)}
        {stockReturn.toFixed(2)}%
      </span>
      <span className={`text-[10px] normal-case tabular ${alphaColor}`}>
        α{sign(alpha)}
        {alpha.toFixed(1)}
      </span>
    </span>
  )
}
