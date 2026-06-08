import { unstable_cache } from "next/cache"
import { Boxes, DatabaseZap, FileClock, Layers3, Route } from "lucide-react"
import { resolveWithFallback } from "@/lib/async-timeout"
import { buildBacktestDataReadinessReport, type BacktestDataReadinessReport, type NonPriceDataStatus } from "@/lib/data-readiness"
import { formatBeijingDateTime } from "@/lib/format"

const getCachedBacktestDataReadinessReport = unstable_cache(
  async () => resolveWithFallback(buildBacktestDataReadinessReport(), {
    timeoutMs: 5_000,
    onFallback: (reason, error) => fallbackReadinessReport(reason, error),
  }),
  ["backtest-data-readiness-report:v2"],
  { revalidate: 300 },
)

export async function BacktestReadinessSection() {
  const report = await getCachedBacktestDataReadinessReport()
  const nextActions = buildReadinessActions(report)

  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <Layers3 className="size-4" aria-hidden />
            backtest readiness
          </div>
          <h2 className="mt-2 text-[20px] font-semibold text-ink">回测数据路线图</h2>
          <p className="mt-1 max-w-[860px] text-[13px] leading-6 text-ink-muted">
            真实回测不只需要价格，还要知道哪些股票已入库、非价格因子缺哪些原始字段，以及每天的数据快照能否复现。
          </p>
        </div>
        <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 text-right">
          <p className="font-mono text-[10px] text-ink-faint">driver</p>
          <p className="font-mono text-[18px] font-semibold text-ink">{report.driver}</p>
          <p className={`mt-1 font-mono text-[10px] ${databaseStatusClass(report.database.status)}`}>{databaseStatusLabel(report.database.status)}</p>
          <p className="mt-1 font-mono text-[10px] text-ink-muted">{formatBeijingDateTime(report.generatedAt, { seconds: true })}</p>
        </div>
      </div>

      {report.database.status !== "ready" && (
        <div className={`mt-4 rounded-[7px] border px-3 py-3 text-[12px] leading-5 ${report.database.status === "permission-error" || report.database.status === "error" ? "border-bear/20 bg-bear/5 text-bear" : "border-warning/20 bg-warning/5 text-warning"}`}>
          <p className="font-semibold">{report.database.note}</p>
          {report.database.error && <p className="mt-1 font-mono text-[11px] opacity-80">{report.database.error}</p>}
        </div>
      )}

      <div className="mt-4 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <Route className="size-4" aria-hidden />
            next data actions
          </div>
          <span className="rounded-[5px] border border-rule bg-white px-2 py-1 font-mono text-[10px] text-ink-muted">
            {nextActions.filter((item) => item.status !== "done").length} 个待处理
          </span>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {nextActions.map((action) => (
            <div key={action.title} className={`rounded-[7px] border px-3 py-3 ${action.status === "done" ? "border-health-ok/20 bg-health-ok/5" : action.status === "blocked" ? "border-bear/20 bg-bear/5" : "border-rule bg-white"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] text-ink-faint">{action.label}</p>
                  <h3 className="mt-1 text-[14px] font-semibold text-ink">{action.title}</h3>
                </div>
                <span className={`rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[9px] ${actionStatusClass(action.status)}`}>
                  {actionStatusLabel(action.status)}
                </span>
              </div>
              <p className="mt-2 font-mono text-[15px] font-semibold text-ink">{action.metric}</p>
              <p className="mt-1 text-[12px] leading-5 text-ink-muted">{action.note}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {report.coverage.stages.map((stage) => (
          <div key={stage.label} className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] text-ink-faint">{stage.label}</span>
              <span className={`rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[9px] ${stage.status === "done" ? "text-health-ok" : stage.status === "active" ? "text-warning" : "text-ink-muted"}`}>
                {stage.status}
              </span>
            </div>
            <p className="mt-2 font-mono text-[18px] font-semibold text-ink">
              {stage.covered}/{stage.target}
            </p>
            <p className="mt-1 text-[11px] leading-4 text-ink-faint">{stage.note}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-rule-soft">
              <div className="h-full bg-health-ok" style={{ width: `${Math.min(100, (stage.covered / Math.max(1, stage.target)) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] text-ink-muted">history depth</p>
            <p className="mt-1 text-[12px] leading-5 text-ink-muted">
              上方是“股票数量覆盖”。这里才是每只股票是否有足够 K 线天数；当前均值约 {report.coverage.averageBarsPerCoveredSymbol} 根/股。
            </p>
          </div>
          <span className="rounded-[5px] border border-rule bg-white px-2 py-1 font-mono text-[10px] text-ink-muted">
            rows {report.coverage.barRows}
          </span>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {report.coverage.depthStages.map((stage) => (
            <div key={stage.label} className="rounded-[7px] border border-rule bg-white px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] text-ink-faint">{stage.label}</span>
                <span className={`rounded-[5px] border border-rule bg-[#fafafa] px-1.5 py-0.5 font-mono text-[9px] ${stage.status === "done" ? "text-health-ok" : stage.status === "partial" ? "text-warning" : "text-bear"}`}>
                  {stage.status}
                </span>
              </div>
              <p className="mt-2 font-mono text-[18px] font-semibold text-ink">{stage.covered}/{stage.target}</p>
              <p className="mt-1 text-[11px] text-ink-faint">至少 {stage.minBars} 根日 K</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="rounded-[7px] border border-rule bg-[#fafafa] p-3">
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <DatabaseZap className="size-4" aria-hidden />
            质量门禁
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {report.quality.map((item) => (
              <div key={item.label} className="rounded-[7px] border border-rule bg-white px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-[10px] text-ink-faint">{item.label}</span>
                  <span className={`font-mono text-[14px] font-semibold ${statusClass(item.status)}`}>{item.value}</span>
                </div>
                <p className="mt-2 text-[12px] leading-5 text-ink-muted">{item.note}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[7px] border border-rule bg-[#fafafa] p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
              <Boxes className="size-4" aria-hidden />
              非价格数据补齐
            </div>
            <span className="font-mono text-[10px] text-ink-faint">raw field backlog</span>
          </div>
          <div className="mt-3 grid gap-2 lg:grid-cols-2">
            {report.nonPrice.map((item) => (
              <NonPriceCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <FileClock className="size-4" aria-hidden />
            每日数据快照
          </div>
          <span className={`rounded-[5px] border border-rule bg-white px-2 py-1 font-mono text-[10px] ${report.snapshots.status === "ready" ? "text-health-ok" : report.snapshots.status === "partial" ? "text-warning" : "text-bear"}`}>
            {report.snapshots.status}
          </span>
        </div>
        <p className="mt-2 text-[12px] leading-5 text-ink-muted">{report.snapshots.note}</p>
        <div className="mt-2 flex flex-wrap gap-2 font-mono text-[10px] text-ink-muted">
          <span className="rounded-[5px] border border-rule bg-white px-2 py-1">rows {report.snapshots.snapshotRows}</span>
          <span className="rounded-[5px] border border-rule bg-white px-2 py-1">latest {report.snapshots.latestSnapshotDate ?? "N/A"}</span>
          <span className="rounded-[5px] border border-rule bg-white px-2 py-1">coverage {report.coverage.earliestDate ?? "N/A"} → {report.coverage.latestDate ?? "N/A"}</span>
        </div>
      </div>
    </section>
  )
}

type ReadinessAction = {
  label: string
  title: string
  metric: string
  note: string
  status: "done" | "active" | "blocked" | "planned"
}

function buildReadinessActions(report: BacktestDataReadinessReport): ReadinessAction[] {
  const currentPool = report.coverage.currentPool || report.coverage.stages[0]?.target || 0
  const missingSymbols = Math.max(0, currentPool - report.coverage.coveredSymbols)
  const nonPriceBacklog = report.nonPrice.filter((item) => item.status !== "ready")
  const hasBadQuality = report.quality.some((item) => item.status === "bad")
  const hasWarnings = report.quality.some((item) => item.status === "warning")

  return [
    {
      label: "step 1",
      title: report.database.status === "ready" ? "历史 K 线底座" : "修复数据库读取",
      metric: report.database.status === "ready" ? `${report.coverage.coveredSymbols}/${currentPool || 0} 只` : databaseStatusLabel(report.database.status),
      note: report.database.status === "ready"
        ? missingSymbols > 0
          ? `先把股票池剩余 ${missingSymbols} 只写入日 K，避免回测样本偏窄。`
          : "股票池价格数据已可作为真实回测缓存。"
        : report.database.note,
      status: report.database.status === "ready" ? (missingSymbols > 0 ? "active" : "done") : "blocked",
    },
    {
      label: "step 2",
      title: "历史窗口深度",
      metric: `${report.coverage.averageBarsPerCoveredSymbol} 根/股`,
      note: report.coverage.averageBarsPerCoveredSymbol >= 500
        ? "已满足长窗回测，后续可以做滚动样本和分市场验证。"
        : report.coverage.averageBarsPerCoveredSymbol >= 300
          ? "已满足半年级回测，下一步加深到 500 根以上以降低偶然性。"
          : "优先补到每只股票 300 根以上，短样本策略不要直接上线雷达。",
      status: report.coverage.averageBarsPerCoveredSymbol >= 500 ? "done" : "active",
    },
    {
      label: "step 3",
      title: "非价格原始字段",
      metric: `${report.nonPrice.length - nonPriceBacklog.length}/${report.nonPrice.length} 类 ready`,
      note: nonPriceBacklog.length > 0
        ? `还有 ${nonPriceBacklog.length} 类资金、财务、事件或情绪字段仍是代理/缺失，相关策略只能观察。`
        : "非价格字段已入库，可支持资金、财务和事件类策略真实验证。",
      status: nonPriceBacklog.length > 0 ? "active" : "done",
    },
    {
      label: "step 4",
      title: "质量审计与快照",
      metric: report.snapshots.status,
      note: report.snapshots.status === "ready" && !hasBadQuality
        ? "每日快照和质量门禁可复现，回测结果更容易追溯。"
        : hasBadQuality
          ? "先修复红色质量项，再允许策略准入雷达。"
          : hasWarnings
            ? "存在黄色质量项，建议补完后再扩大策略上线范围。"
            : "等待写入 data_quality_snapshots，避免每次回测环境不可复现。",
      status: report.snapshots.status === "ready" && !hasBadQuality ? (hasWarnings ? "active" : "done") : "active",
    },
  ]
}

function fallbackReadinessReport(reason: "timeout" | "error", error?: unknown): BacktestDataReadinessReport {
  const now = new Date().toISOString()
  const note = reason === "timeout"
    ? "数据路线图读取超过 5 秒，页面先降级展示；后台状态稍后会自动刷新。"
    : error instanceof Error ? error.message : "数据路线图读取失败。"
  return {
    generatedAt: now,
    driver: "postgres",
    database: {
      status: reason === "timeout" ? "partial" : "error",
      note,
      error: reason === "error" ? note : undefined,
    },
    coverage: {
      currentPool: 0,
      coveredSymbols: 0,
      barRows: 0,
      averageBarsPerCoveredSymbol: 0,
      stages: [
        { label: "股票池覆盖", target: 130, covered: 0, status: "active", note: "等待数据库快照返回" },
        { label: "扩容到 300 只", target: 300, covered: 0, status: "active", note: "股票数量目标，不是 K 线天数" },
        { label: "扩容到 500 只", target: 500, covered: 0, status: "planned", note: "股票数量目标，不是 K 线天数" },
        { label: "全 A 股票覆盖", target: 5200, covered: 0, status: "planned", note: "全市场股票数量目标" },
      ],
      depthStages: [
        { label: "短窗回测", minBars: 120, covered: 0, target: 130, status: "missing" },
        { label: "半年级回测", minBars: 300, covered: 0, target: 130, status: "missing" },
        { label: "长窗回测", minBars: 500, covered: 0, target: 130, status: "missing" },
      ],
    },
    nonPrice: [],
    quality: [
      {
        label: "数据库响应",
        value: "degraded",
        status: reason === "timeout" ? "warning" : "bad",
        note,
      },
    ],
    snapshots: {
      status: "missing",
      snapshotRows: 0,
      note: "等待数据库质量快照返回。",
    },
  }
}

function NonPriceCard({ item }: { item: NonPriceDataStatus }) {
  return (
    <div className="rounded-[7px] border border-rule bg-white px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] text-ink-faint">{item.category}</p>
          <h3 className="mt-1 text-[14px] font-semibold text-ink">{item.name}</h3>
        </div>
        <span className={`rounded-[5px] border border-rule bg-[#fafafa] px-1.5 py-0.5 font-mono text-[10px] ${item.status === "ready" ? "text-health-ok" : item.status === "proxy" ? "text-warning" : "text-bear"}`}>
          {item.status === "proxy" ? "K线代理" : item.status}
        </span>
      </div>
      <p className="mt-2 text-[12px] leading-5 text-ink-muted">{item.note}</p>
      <p className="mt-2 font-mono text-[10px] leading-4 text-ink-faint">{item.storage}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {item.requiredFor.slice(0, 3).map((need) => (
          <span key={need} className="rounded-[5px] border border-rule bg-[#fafafa] px-2 py-0.5 font-mono text-[10px] text-ink-muted">
            {need}
          </span>
        ))}
      </div>
    </div>
  )
}

function statusClass(status: "good" | "warning" | "bad") {
  return status === "good" ? "text-health-ok" : status === "warning" ? "text-warning" : "text-bear"
}

function databaseStatusLabel(status: "ready" | "partial" | "permission-error" | "missing" | "error") {
  if (status === "ready") return "可读"
  if (status === "partial") return "未入库"
  if (status === "permission-error") return "权限错误"
  if (status === "missing") return "未接入"
  return "异常"
}

function databaseStatusClass(status: "ready" | "partial" | "permission-error" | "missing" | "error") {
  if (status === "ready") return "text-health-ok"
  if (status === "partial" || status === "missing") return "text-warning"
  return "text-bear"
}

function actionStatusLabel(status: ReadinessAction["status"]) {
  if (status === "done") return "done"
  if (status === "blocked") return "blocked"
  if (status === "planned") return "planned"
  return "active"
}

function actionStatusClass(status: ReadinessAction["status"]) {
  if (status === "done") return "text-health-ok"
  if (status === "blocked") return "text-bear"
  if (status === "planned") return "text-ink-muted"
  return "text-warning"
}
