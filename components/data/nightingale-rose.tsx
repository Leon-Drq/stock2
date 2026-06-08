"use client"

import type { HealthReport, DataSourceHealth } from "@/lib/data-health"

/**
 * 南丁格尔玫瑰图 v3 — 静态信息版本
 *
 * 设计原则：
 *  1. 所有数据点静态可见，无需悬停。
 *  2. 视觉只承担"哪些源稳/不稳"，延迟/工具数信息让位给右侧文字。
 *  3. 任何文字与瓣块/弧线重叠时，用米白色 paint-order 描边强制可读。
 */

const SHORT_LABELS: Record<string, string> = {
  "k-line": "K 线",
  realtime: "实时",
  "fin-statement": "财报",
  "north-bound": "北向",
  "dragon-tiger": "龙虎",
  margin: "两融",
  "fund-flow": "主力",
  announcement: "公告",
  news: "新闻",
  index: "指数",
  concept: "概念",
  macro: "宏观",
}

const STATUS_FILL: Record<string, string> = {
  healthy: "var(--color-health-ok)",
  degraded: "var(--color-health-warn)",
  "rate-limited": "var(--color-health-warn)",
  down: "var(--color-health-bad)",
  unknown: "var(--color-health-mute)",
}

const STATUS_LABEL: Record<string, string> = {
  healthy: "正常",
  degraded: "降级",
  "rate-limited": "限速",
  down: "中断",
  unknown: "未知",
}

const CATEGORY_ORDER = ["行情", "财务", "资金", "事件", "情绪", "另类"] as const

/* —— 极坐标几何（从内到外） —— */
const SIZE = 720
const CENTER = SIZE / 2
const R_HERO = 72 // 中心 hero 圆
const R_TICK_START = 86 // 瓣块起点 = 0% 半径
const R_BAR_MAX = 192 // 100% 瓣的半径
const R_NAME = 222 // 源名
const R_PCT = 242 // 成功率%
const R_CAT_ARC = 268 // 类目弧
const R_CAT_LABEL = 290 // 类目名

/* 文字描边（避免任何遮挡） */
const HALO: React.CSSProperties = {
  paintOrder: "stroke",
  stroke: "var(--color-paper)",
  strokeWidth: 4.5,
  strokeLinejoin: "round",
}
const HALO_THIN: React.CSSProperties = {
  paintOrder: "stroke",
  stroke: "var(--color-paper)",
  strokeWidth: 3,
  strokeLinejoin: "round",
}

function polar(r: number, angleDeg: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180
  return { x: CENTER + r * Math.cos(a), y: CENTER + r * Math.sin(a) }
}

function wedgePath(innerR: number, outerR: number, startA: number, endA: number) {
  const p1 = polar(innerR, startA)
  const p2 = polar(outerR, startA)
  const p3 = polar(outerR, endA)
  const p4 = polar(innerR, endA)
  return [
    `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
    `L ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    `A ${outerR} ${outerR} 0 0 1 ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
    `L ${p4.x.toFixed(2)} ${p4.y.toFixed(2)}`,
    `A ${innerR} ${innerR} 0 0 0 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
    "Z",
  ].join(" ")
}

function arcStrokePath(r: number, startA: number, endA: number) {
  const p1 = polar(r, startA)
  const p2 = polar(r, endA)
  const largeArc = endA - startA > 180 ? 1 : 0
  return `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
}

function sortedItems(items: DataSourceHealth[]) {
  return [...items].sort((a, b) => {
    const ca = CATEGORY_ORDER.indexOf(a.source.category as (typeof CATEGORY_ORDER)[number])
    const cb = CATEGORY_ORDER.indexOf(b.source.category as (typeof CATEGORY_ORDER)[number])
    if (ca !== cb) return ca - cb
    return a.source.name.localeCompare(b.source.name, "zh")
  })
}

export function NightingaleRose({ report }: { report: HealthReport }) {
  const items = sortedItems(report.items)
  const seg = 360 / items.length

  /* 计算类目分组弧 */
  const categoryArcs: { category: string; startA: number; endA: number; count: number }[] = []
  let currentCat = ""
  let arcStart = 0
  let count = 0
  items.forEach((it, idx) => {
    const cat = it.source.category
    if (cat !== currentCat) {
      if (currentCat) categoryArcs.push({ category: currentCat, startA: arcStart, endA: idx * seg, count })
      currentCat = cat
      arcStart = idx * seg
      count = 1
    } else {
      count++
    }
    if (idx === items.length - 1) {
      categoryArcs.push({ category: currentCat, startA: arcStart, endA: (idx + 1) * seg, count })
    }
  })

  /* 自动洞察 */
  const ranked = items.filter((i) => i.avgSuccessRate != null)
  const best = ranked.slice().sort((a, b) => (b.avgSuccessRate ?? 0) - (a.avgSuccessRate ?? 0))[0]
  const fastest = items
    .filter((i) => i.avgLatencyMs != null && i.status !== "down")
    .sort((a, b) => (a.avgLatencyMs as number) - (b.avgLatencyMs as number))[0]
  const broken = items
    .filter((i) => i.status === "down" || i.status === "unknown")
    .sort((a, b) => a.source.name.localeCompare(b.source.name, "zh"))
  const slowest = items
    .filter((i) => i.avgLatencyMs != null)
    .sort((a, b) => (b.avgLatencyMs as number) - (a.avgLatencyMs as number))[0]

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(240px,280px)] lg:gap-10">
      {/* 左：极坐标信息图 */}
      <div className="relative mx-auto w-full max-w-[560px] lg:mx-0 lg:max-w-[660px]">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="block h-auto w-full"
          role="img"
          aria-label="12 个 A 股数据源的成功率玫瑰图"
        >
          {/* 同心刻度环 + 数字（数字放在外圈最右侧 3 点钟，绕过所有瓣） */}
          {[0.25, 0.5, 0.75, 1].map((t) => {
            const r = R_TICK_START + (R_BAR_MAX - R_TICK_START) * t
            return (
              <g key={t}>
                <circle
                  cx={CENTER}
                  cy={CENTER}
                  r={r}
                  fill="none"
                  stroke="var(--color-rule)"
                  strokeWidth={t === 1 ? 1 : 0.5}
                  strokeDasharray={t === 1 ? "0" : "2 4"}
                  opacity={0.7}
                />
              </g>
            )
          })}

          {/* 主瓣 */}
          {items.map((it, idx) => {
            const startA = idx * seg + 1.2
            const endA = (idx + 1) * seg - 1.2
            const rate = it.avgSuccessRate ?? 0
            const outerR = R_TICK_START + (R_BAR_MAX - R_TICK_START) * Math.max(0.04, rate)
            const fill = STATUS_FILL[it.status] ?? "var(--color-ink-faint)"
            return (
              <path
                key={it.source.id}
                d={wedgePath(R_TICK_START, outerR, startA, endA)}
                fill={fill}
                fillOpacity={0.55}
                stroke={fill}
                strokeWidth={1}
              />
            )
          })}

          {/* 外圈标签：源名 + 成功率（两行，加 paper halo 描边） */}
          {items.map((it, idx) => {
            const midA = (idx + 0.5) * seg
            const rate = it.avgSuccessRate ?? 0
            const fill = STATUS_FILL[it.status] ?? "var(--color-ink-faint)"
            const namePos = polar(R_NAME, midA)
            const pctPos = polar(R_PCT, midA)
            const shortName = SHORT_LABELS[it.source.id] ?? it.source.name.slice(0, 2)
            return (
              <g key={`label-${it.source.id}`}>
                <text
                  x={namePos.x}
                  y={namePos.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-ink font-display"
                  fontSize={15}
                  fontWeight={500}
                  style={HALO}
                >
                  {shortName}
                </text>
                <text
                  x={pctPos.x}
                  y={pctPos.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="font-mono"
                  fontSize={12}
                  fontWeight={600}
                  fill={fill}
                  style={HALO_THIN}
                >
                  {rate > 0 ? `${Math.round(rate * 100)}%` : "—"}
                </text>
              </g>
            )
          })}

          {/* 12 条径向分隔刻度（瓣之间） */}
          {items.map((_, idx) => {
            const a = idx * seg
            const p1 = polar(R_TICK_START - 2, a)
            const p2 = polar(R_BAR_MAX + 4, a)
            return (
              <line
                key={`div-${idx}`}
                x1={p1.x}
                y1={p1.y}
                x2={p2.x}
                y2={p2.y}
                stroke="var(--color-paper)"
                strokeWidth={1.5}
              />
            )
          })}

          {/* 刻度数字：只在 12 点钟标一次，加描边，绕开瓣 */}
          {[0.25, 0.5, 0.75, 1].map((t) => {
            const r = R_TICK_START + (R_BAR_MAX - R_TICK_START) * t
            // 标在每段瓣间的间隙正中，最简单选 12 点钟（角度=0）
            return (
              <text
                key={`tick-${t}`}
                x={CENTER}
                y={CENTER - r}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-ink-muted font-mono"
                fontSize={9}
                style={HALO_THIN}
              >
                {Math.round(t * 100)}
              </text>
            )
          })}

          {/* 类目分隔射线 + 类目外弧 + 类目标签 */}
          {categoryArcs.map((arc, i) => {
            const midA = (arc.startA + arc.endA) / 2
            const labelPos = polar(R_CAT_LABEL, midA)
            const dividerEnd = polar(R_CAT_ARC + 4, arc.startA)
            const dividerStart = polar(R_TICK_START - 4, arc.startA)
            return (
              <g key={arc.category}>
                {i > 0 && (
                  <line
                    x1={dividerStart.x}
                    y1={dividerStart.y}
                    x2={dividerEnd.x}
                    y2={dividerEnd.y}
                    stroke="var(--color-rule)"
                    strokeWidth={0.8}
                  />
                )}
                <path
                  d={arcStrokePath(R_CAT_ARC, arc.startA + 2.4, arc.endA - 2.4)}
                  fill="none"
                  stroke="var(--color-ink-muted)"
                  strokeWidth={1}
                />
                <text
                  x={labelPos.x}
                  y={labelPos.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  className="fill-ink font-display"
                  fontSize={13}
                  fontStyle="italic"
                  fontWeight={500}
                  style={{ ...HALO, letterSpacing: "0.04em" }}
                >
                  {arc.category} · {arc.count}
                </text>
              </g>
            )
          })}

          {/* 中心 hero（足够大，三行间距 ≥ 22px） */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={R_HERO}
            fill="var(--color-paper)"
            stroke="var(--color-rule)"
            strokeWidth={1}
          />
          <text
            x={CENTER}
            y={CENTER - 28}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-ink-muted font-mono"
            fontSize={10}
            style={{ letterSpacing: "0.22em" }}
          >
            A 股数据源
          </text>
          <text
            x={CENTER}
            y={CENTER + 4}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-ink font-display"
            fontSize={42}
            fontWeight={500}
          >
            {report.totalSources}
          </text>
          <text
            x={CENTER}
            y={CENTER + 38}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-ink-muted font-mono"
            fontSize={10}
            style={{ letterSpacing: "0.14em" }}
          >
            {report.totalTools} 个工具
          </text>
        </svg>
      </div>

      {/* 右：编码说明 + 自动洞察（小屏并排 3 栏，桌面纵向） */}
      <aside className="grid grid-cols-1 gap-6 self-start border-t border-rule pt-6 sm:grid-cols-3 lg:grid-cols-1 lg:border-t-0 lg:pt-6">
        {/* 状态分布 */}
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted">状态分布</p>
          <ul className="mt-3 space-y-2 font-mono text-[12.5px] text-ink">
            {(["healthy", "degraded", "down"] as const).map((s) => {
              const count = items.filter((i) =>
                s === "degraded"
                  ? i.status === "degraded" || i.status === "rate-limited"
                  : i.status === s,
              ).length
              return (
                <li key={s} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2.5">
                    <span
                      className="inline-block h-3 w-3"
                      style={{ background: STATUS_FILL[s] }}
                      aria-hidden
                    />
                    <span className="font-display text-[13.5px]">{STATUS_LABEL[s]}</span>
                  </span>
                  <span className="text-ink-muted">{count}</span>
                </li>
              )
            })}
          </ul>
        </div>

        {/* 编码说明 */}
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted">图例</p>
          <ul className="mt-3 space-y-1.5 font-serif text-[13px] leading-relaxed text-ink-muted">
            <li>
              <span className="text-ink">瓣块长度</span> 平均成功率
            </li>
            <li>
              <span className="text-ink">瓣块颜色</span> 健康状态
            </li>
            <li>
              <span className="text-ink">外圈数字</span> 成功率 %
            </li>
            <li>
              <span className="text-ink">外环弧</span> 类目分组
            </li>
          </ul>
        </div>

        {/* 自动洞察 */}
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted">今日观察</p>
          <ul className="mt-3 space-y-3.5 font-serif text-[13.5px] leading-relaxed text-ink">
            {best && (
              <li>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
                  最稳
                </span>
                <div className="mt-0.5">
                  <span>{best.source.name}</span>
                  <span className="ml-2 font-mono text-[12.5px] text-health-ok">
                    {Math.round((best.avgSuccessRate ?? 0) * 100)}%
                  </span>
                </div>
              </li>
            )}
            {fastest && (
              <li>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
                  最快
                </span>
                <div className="mt-0.5">
                  <span>{fastest.source.name}</span>
                  <span className="ml-2 font-mono text-[12.5px] text-ink-muted">
                    {fastest.avgLatencyMs} ms
                  </span>
                </div>
              </li>
            )}
            {slowest && (
              <li>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-ink-faint">
                  最慢
                </span>
                <div className="mt-0.5">
                  <span>{slowest.source.name}</span>
                  <span className="ml-2 font-mono text-[12.5px] text-health-warn">
                    {slowest.avgLatencyMs} ms
                  </span>
                </div>
              </li>
            )}
            {broken.length > 0 ? (
              <li>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-health-bad">
                  待修复
                </span>
                <div className="mt-0.5">
                  {broken
                    .slice(0, 3)
                    .map((b) => b.source.name)
                    .join(" · ")}
                  {broken.length > 3 && (
                    <span className="ml-1 text-ink-faint">+{broken.length - 3}</span>
                  )}
                </div>
              </li>
            ) : (
              <li>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-health-ok">
                  全员在线
                </span>
                <div className="mt-0.5 text-ink-muted">所有源至少有一个可用工具</div>
              </li>
            )}
          </ul>
        </div>
      </aside>
    </div>
  )
}
