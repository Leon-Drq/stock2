"use client"

import type { HealthReport, DataSourceHealth } from "@/lib/data-health"
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
  ReferenceArea,
  ReferenceLine,
} from "recharts"

/**
 * 质量–速度象限 v3 — 编号 + 详情列表
 *
 * 上一版的痛点是 12 个气泡在左上角"理想区"严重碰撞、标签互相穿插。
 * 解决方案：
 *  - 气泡缩小到 r ∈ [8, 22]，点上只渲染序号 1-12
 *  - 右侧固定一个 12 行详情列表，列出每个源的全量字段
 *  - 序号与气泡颜色、状态、列表行 一一对应
 *  - 完全不依赖悬停
 */

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

type Point = {
  idx: number
  x: number
  y: number
  z: number
  fill: string
  item: DataSourceHealth
}

const Q_LABELS: Array<{ tag: string; copy: string; cls: string; pos: { x: number; y: number; anchor: "start" | "end" } }> = [
  { tag: "理想", copy: "快且稳 · 适合日内", cls: "text-health-ok", pos: { x: 0.02, y: 0.97, anchor: "start" } },
  { tag: "稳但慢", copy: "适合周期 / T+1", cls: "text-ink-muted", pos: { x: 0.98, y: 0.97, anchor: "end" } },
  { tag: "不可靠", copy: "快但成功率低", cls: "text-health-warn", pos: { x: 0.02, y: 0.05, anchor: "start" } },
  { tag: "待修复", copy: "慢且不可靠", cls: "text-health-bad", pos: { x: 0.98, y: 0.05, anchor: "end" } },
]

export function QualityScatter({ report }: { report: HealthReport }) {
  const valid = report.items.filter((i) => i.avgSuccessRate != null && i.avgLatencyMs != null)
  // 缺失数据的源排末尾
  const missing = report.items.filter((i) => i.avgSuccessRate == null || i.avgLatencyMs == null)

  const maxLatency = Math.max(2400, ...valid.map((i) => (i.avgLatencyMs as number) || 0))

  const points: Point[] = valid.map((it, idx) => ({
    idx: idx + 1,
    x: it.avgLatencyMs as number,
    y: Math.round((it.avgSuccessRate as number) * 100),
    z: Math.max(1, it.toolCount), // ZAxis 决定气泡半径
    fill: STATUS_FILL[it.status] ?? "var(--color-ink-faint)",
    item: it,
  }))

  // 索引 12 个源（valid + missing 拼接，保持编号连续）
  const allIndexed = [...valid, ...missing].map((item, i) => ({ idx: i + 1, item }))

  // 象限划分阈值
  const xMid = maxLatency / 2
  const yMid = 75 // 75% 成功率作为界限

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_minmax(280px,360px)] lg:gap-10">
      {/* 左：散点 */}
      <div className="relative h-[340px] w-full sm:h-[400px] lg:h-[460px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 24, right: 36, bottom: 56, left: 36 }}>
            <CartesianGrid stroke="var(--color-rule)" strokeDasharray="2 4" opacity={0.6} />
            <XAxis
              type="number"
              dataKey="x"
              domain={[0, maxLatency]}
              tickFormatter={(v) => `${v}ms`}
              stroke="var(--color-ink-muted)"
              tick={{ fill: "var(--color-ink-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}
              tickLine={{ stroke: "var(--color-ink-muted)" }}
              axisLine={{ stroke: "var(--color-ink)" }}
              label={{
                value: "平均执行延迟 →",
                position: "insideBottom",
                offset: -32,
                fill: "var(--color-ink)",
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.12em",
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={[0, 100]}
              tickFormatter={(v) => `${v}%`}
              stroke="var(--color-ink-muted)"
              tick={{ fill: "var(--color-ink-muted)", fontSize: 11, fontFamily: "var(--font-mono)" }}
              tickLine={{ stroke: "var(--color-ink-muted)" }}
              axisLine={{ stroke: "var(--color-ink)" }}
              label={{
                value: "↑ 成功率",
                position: "insideLeft",
                angle: -90,
                offset: 4,
                style: { textAnchor: "middle" },
                fill: "var(--color-ink)",
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.12em",
              }}
            />
            <ZAxis type="number" dataKey="z" range={[80, 360]} />

            {/* 理想区背景 */}
            <ReferenceArea
              x1={0}
              x2={xMid}
              y1={yMid}
              y2={100}
              fill="var(--color-health-ok)"
              fillOpacity={0.07}
              stroke="none"
            />
            <ReferenceLine x={xMid} stroke="var(--color-rule)" strokeDasharray="3 3" />
            <ReferenceLine y={yMid} stroke="var(--color-rule)" strokeDasharray="3 3" />

            <Scatter data={points} shape={(props: any) => <PointShape {...props} />} isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>

        {/* 四象限标签：用绝对定位叠在容器上（不依赖 chart 坐标系，避免被气泡遮挡） */}
        <div className="pointer-events-none absolute inset-0">
          {Q_LABELS.map((q) => (
            <div
              key={q.tag}
              className="absolute"
              style={{
                left: `${q.pos.x * 100}%`,
                top: `${(1 - q.pos.y) * 100}%`,
                transform:
                  q.pos.anchor === "start" ? "translate(8px, 8px)" : "translate(-8px, 8px)",
              }}
            >
              <div
                className={`font-display text-[13px] font-medium leading-none ${q.cls}`}
                style={{ textAlign: q.pos.anchor }}
              >
                {q.tag}
              </div>
              <div
                className="mt-1 font-serif text-[11px] italic leading-none text-ink-muted"
                style={{ textAlign: q.pos.anchor }}
              >
                {q.copy}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 右：12 行详情列表 */}
      <aside className="self-start">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted">
          坐标对照 · {allIndexed.length} 个源
        </p>
        <ol className="mt-3 divide-y divide-rule border-y border-rule">
          {allIndexed.map(({ idx, item }) => {
            const fill = STATUS_FILL[item.status] ?? "var(--color-ink-faint)"
            return (
              <li key={item.source.id} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 py-2">
                {/* 编号 + 状态色块 */}
                <span
                  className="flex h-6 w-6 items-center justify-center font-mono text-[11px] font-semibold"
                  style={{
                    background: fill,
                    color: "var(--color-paper)",
                  }}
                  aria-label={STATUS_LABEL[item.status]}
                >
                  {idx}
                </span>

                {/* 源名 + 类目 */}
                <div className="min-w-0">
                  <div className="truncate font-display text-[13.5px] text-ink">
                    {item.source.name}
                  </div>
                  <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-faint">
                    {item.source.category} · {item.toolCount} TOOL{item.toolCount === 1 ? "" : "S"}
                  </div>
                </div>

                {/* 数值 */}
                <div className="text-right">
                  <div className="font-mono text-[12.5px] font-semibold" style={{ color: fill }}>
                    {item.avgSuccessRate != null
                      ? `${Math.round(item.avgSuccessRate * 100)}%`
                      : "—"}
                  </div>
                  <div className="font-mono text-[10.5px] text-ink-muted">
                    {item.avgLatencyMs != null ? `${item.avgLatencyMs}ms` : "—"}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>

        <p className="mt-4 font-serif text-[12px] italic leading-relaxed text-ink-muted">
          数字与左图气泡上的编号一一对应。气泡大小 = 匹配工具数，颜色 = 健康状态。
        </p>
      </aside>
    </div>
  )
}

/** 自定义点形状：圆 + 中心序号 */
function PointShape(props: any) {
  const { cx, cy, payload, fill } = props
  if (typeof cx !== "number" || typeof cy !== "number") return null
  // 根据 z（toolCount）算半径；recharts 已经把 z 映射到 size，但 size 是面积，自己再换算
  const size = props.size ?? 200
  const r = Math.max(8, Math.min(22, Math.sqrt(size / Math.PI)))
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={fill} fillOpacity={0.65} stroke={fill} strokeWidth={1.5} />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={r >= 12 ? 12 : 10}
        fontWeight={700}
        fill="var(--color-paper)"
        fontFamily="var(--font-mono)"
        style={{
          paintOrder: "stroke",
          stroke: fill,
          strokeWidth: 0.5,
        }}
      >
        {payload?.idx ?? ""}
      </text>
    </g>
  )
}
