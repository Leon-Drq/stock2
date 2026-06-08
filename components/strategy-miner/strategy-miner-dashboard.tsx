import Link from "next/link"
import { Activity, ClipboardCheck, Database, ExternalLink, FlaskConical, GitBranch, ShieldCheck, TestTube2 } from "lucide-react"
import { formatBeijingDateTime } from "@/lib/format"
import type { StrategyMiningCandidate, StrategyMiningReport } from "@/lib/strategy-miner"

export function StrategyMinerDashboard({ report }: { report: StrategyMiningReport }) {
  const incubation = summarizeIncubation(report)
  const research = summarizeResearch(report)

  return (
    <div className="mt-5 space-y-5">
      <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] text-ink-muted">strategy miner</p>
            <h2 className="mt-2 text-[18px] font-semibold text-ink">外部候选策略挖掘流水线</h2>
            <p className="mt-1 max-w-[780px] text-[13px] leading-5 text-ink-muted">
              只提取公开仓库和经典策略里的可解释规则，转成内部因子 DSL 后统一用 Qveris/Supabase 历史数据回测；未通过准入的候选不会进入雷达。
            </p>
          </div>
          <span className={`rounded-[7px] border px-3 py-2 font-mono text-[11px] ${
            report.store.persisted ? "border-rule bg-[#e7f4eb] text-health-ok" : "border-rule bg-[#fafafa] text-warning"
          }`}>
            {report.store.persisted ? "postgres persisted" : "not persisted"}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
          <SummaryCard label="来源" value={report.summary.sources} />
          <SummaryCard label="GitHub" value={report.summary.github} />
          <SummaryCard label="候选" value={report.summary.candidates} />
          <SummaryCard label="已回测" value={report.summary.backtested} />
          <SummaryCard label="晋级" value={report.summary.promoted} tone="good" />
          <SummaryCard label="观察" value={report.summary.watchlist} tone="warning" />
          <SummaryCard label="淘汰" value={report.summary.rejected} tone="bad" />
        </div>

        <div className="mt-4 grid gap-2 md:grid-cols-5">
          <PipelineStep icon={<GitBranch className="size-4" />} title="发现" desc="GitHub 搜索 + 内置公开模板" />
          <PipelineStep icon={<TestTube2 className="size-4" />} title="转译" desc="外部规则映射为内部因子 DSL" />
          <PipelineStep icon={<Database className="size-4" />} title="回测" desc="Qveris/Supabase 真实历史 K 线" />
          <PipelineStep icon={<FlaskConical className="size-4" />} title="孵化" desc="样本外、行情覆盖、参数压力" />
          <PipelineStep icon={<ShieldCheck className="size-4" />} title="准入" desc="雷达前先过模拟观察" />
        </div>
      </section>

      <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] text-ink-muted">research queue</p>
            <h2 className="mt-2 text-[18px] font-semibold text-ink">策略研究队列</h2>
            <p className="mt-1 max-w-[760px] text-[13px] leading-5 text-ink-muted">
              新挖到的策略先按交易逻辑分桶，再标出数据需求和反过拟合检查。只有数据可复现、样本外稳定、交易成本合理，才进入雷达或模拟盘。
            </p>
          </div>
          <span className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink-muted">
            {research.totalDataNeeds} data needs
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
          {research.archetypes.map((item) => (
            <SummaryCard key={item.label} label={item.label} value={item.value} tone={item.tone} />
          ))}
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-3">
          {research.nextActions.map((action) => (
            <div key={action.title} className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
              <div className="flex items-center gap-2 text-ink">
                <ClipboardCheck className="size-4" aria-hidden />
                <span className="text-[13px] font-semibold">{action.title}</span>
              </div>
              <p className="mt-2 text-[12px] leading-5 text-ink-muted">{action.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] text-ink-muted">incubator v2</p>
            <h2 className="mt-2 text-[18px] font-semibold text-ink">策略孵化准入</h2>
            <p className="mt-1 max-w-[760px] text-[13px] leading-5 text-ink-muted">
              候选策略不会只看单次年化，系统会检查样本外衰减、强弱市场覆盖、过拟合风险和缺失数据，合格后先进入模拟观察。
            </p>
          </div>
          <span className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink-muted">
            avg score {incubation.averageScore}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
          <SummaryCard label="模拟观察" value={incubation.paperWatch} tone="good" />
          <SummaryCard label="修正复测" value={incubation.retest} tone="warning" />
          <SummaryCard label="高过拟合" value={incubation.highOverfit} tone="bad" />
          <SummaryCard label="样本外通过" value={incubation.walkForwardPass} tone="good" />
          <SummaryCard label="多行情覆盖" value={incubation.multiRegime} />
          <SummaryCard label="数据缺口" value={incubation.dataGaps} tone="warning" />
        </div>
      </section>

      <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="text-[18px] font-semibold text-ink">候选策略回测结果</h2>
            <p className="mt-1 text-[13px] text-ink-muted">生成时间 {formatBeijingDateTime(report.generatedAt, { seconds: true })}</p>
          </div>
          <Link
            href="/strategies"
            className="inline-flex h-9 items-center rounded-[7px] border border-rule bg-[#fafafa] px-3 font-mono text-[11px] text-ink transition hover:bg-white"
          >
            返回策略目录
          </Link>
        </div>

        <div className="grid gap-2">
          {report.candidates.map((candidate) => (
            <CandidateRow key={candidate.candidateId} candidate={candidate} />
          ))}
        </div>
      </section>

      <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <p className="font-mono text-[11px] text-ink-muted">运行日志</p>
        <div className="mt-3 grid gap-2">
          {report.notes.slice(0, 8).map((note) => (
            <p key={note} className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 text-[12px] leading-5 text-ink-muted">
              {note}
            </p>
          ))}
          {report.store.error && (
            <p className="rounded-[7px] border border-rule bg-[#fff7ed] px-3 py-2 text-[12px] leading-5 text-warning">
              Supabase 写入失败：{report.store.error}
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

function CandidateRow({ candidate }: { candidate: StrategyMiningCandidate }) {
  const admission = candidate.report?.diagnosis.admission
  const incubation = candidate.incubation
  return (
    <article className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={candidate.status} />
            <h3 className="text-[16px] font-semibold text-ink">{candidate.strategy.name}</h3>
            <span className="rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
              {candidate.source.kind}
            </span>
            {candidate.source.stars != null && (
              <span className="rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
                ★ {candidate.source.stars}
              </span>
            )}
            {admission && (
              <span className={`rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] ${admissionClass(candidate.status)}`}>
                {admission.gate} · {admission.score}
              </span>
            )}
            {incubation && (
              <span className={`rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] ${incubationClass(incubation.gate)}`}>
                {incubation.gate} · {incubation.score}
              </span>
            )}
          </div>
          <p className="mt-2 text-[13px] leading-5 text-ink-muted">{candidate.hypothesis}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {candidate.strategy.factors.map((factor) => (
              <span key={factor} className="rounded-[5px] border border-rule bg-white px-2 py-0.5 font-mono text-[10px] text-ink-soft">
                {factor}
              </span>
            ))}
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            <ResearchMiniCard label="类型" value={candidate.research.archetype} />
            <ResearchMiniCard label="去向" value={candidate.research.promotionPath} />
            <ResearchMiniCard label="证据" value={candidate.research.evidence} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[10px] text-ink-muted">
            <a href={candidate.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-ink">
              {candidate.source.name}
              <ExternalLink className="size-3" aria-hidden />
            </a>
            {candidate.source.language && <span>{candidate.source.language}</span>}
            {candidate.source.license && <span>{candidate.source.license}</span>}
          </div>
        </div>

        <div className="shrink-0">
          <div className="grid grid-cols-2 gap-3 text-right sm:grid-cols-4 sm:gap-4">
            <Metric label="年化" value={formatPercent(candidate.metrics?.annualReturn)} tone={(candidate.metrics?.annualReturn ?? 0) >= 0 ? "up" : "down"} />
            <Metric label="超额" value={formatPercent(candidate.metrics?.excessReturn)} tone={(candidate.metrics?.excessReturn ?? 0) >= 0 ? "up" : "down"} />
            <Metric label="回撤" value={candidate.metrics ? `-${candidate.metrics.maxDrawdown.toFixed(2)}%` : "N/A"} tone="down" />
            <Metric label="Sharpe" value={candidate.metrics?.sharpe?.toFixed(2) ?? "N/A"} />
          </div>
          {incubation && (
            <div className="mt-4 grid grid-cols-2 gap-3 text-right sm:grid-cols-4 sm:gap-4">
              <Metric label="样本外" value={formatPercent(incubation.walkForward.outSampleAnnualReturn)} tone={incubation.walkForward.pass ? "up" : "down"} />
              <Metric label="衰减" value={`${incubation.walkForward.decayPct.toFixed(1)}%`} tone={incubation.walkForward.decayPct <= 45 ? "up" : "down"} />
              <Metric label="覆盖" value={`${incubation.marketCoverage}/3`} />
              <Metric label="过拟合" value={riskLabel(incubation.overfitRisk)} tone={incubation.overfitRisk === "high" ? "down" : "up"} />
            </div>
          )}
          <div className="mt-4 flex justify-start gap-2 xl:justify-end">
            <Link
              href={`/backtest?strategy=${encodeURIComponent(candidate.strategy.id)}`}
              className="inline-flex h-8 items-center rounded-[7px] border border-rule bg-white px-3 font-mono text-[11px] text-ink transition hover:bg-[#f5f5f4]"
            >
              查看回测
            </Link>
          </div>
        </div>
      </div>
      {admission?.reason && (
        <p className="mt-3 rounded-[7px] border border-rule bg-white px-3 py-2 text-[12px] leading-5 text-ink-muted">
          {admission.reason}
        </p>
      )}
      {incubation && (
        <div className="mt-3 grid gap-2 border-t border-rule-soft pt-3 xl:grid-cols-[1fr_1fr]">
          <div className="rounded-[7px] border border-rule bg-white px-3 py-2">
            <div className="flex items-center gap-2 font-mono text-[10px] text-ink-muted">
              <Activity className="size-3.5" aria-hidden />
              孵化压力测试
            </div>
            <div className="mt-2 grid gap-1.5">
              {incubation.parameterGrid.slice(0, 4).map((item) => (
                <div key={item.name} className="flex items-start justify-between gap-3 rounded-[5px] bg-[#fafafa] px-2 py-1.5">
                  <span className="text-[12px] text-ink">{item.name}</span>
                  <span className={`shrink-0 font-mono text-[10px] ${gridStatusClass(item.status)}`}>{item.status} · {item.score}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-[7px] border border-rule bg-white px-3 py-2">
            <p className="font-mono text-[10px] text-ink-muted">下一步修正</p>
            <div className="mt-2 grid gap-1.5">
              {incubation.nextActions.slice(0, 3).map((action) => (
                <p key={action} className="text-[12px] leading-5 text-ink-muted">+ {action}</p>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="mt-3 grid gap-2 border-t border-rule-soft pt-3 xl:grid-cols-[1fr_1fr]">
        <ResearchList title="数据需求" items={candidate.research.dataNeeds} />
        <ResearchList title="反过拟合检查" items={candidate.research.antiOverfitChecks} />
      </div>
    </article>
  )
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone?: "good" | "warning" | "bad" }) {
  const color = tone === "good" ? "text-bull" : tone === "warning" ? "text-warning" : tone === "bad" ? "text-bear" : "text-ink"
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className={`mt-1 font-mono text-[22px] font-semibold ${color}`}>{value}</p>
    </div>
  )
}

function PipelineStep({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <div className="flex items-center gap-2 text-ink">
        {icon}
        <span className="text-[13px] font-semibold">{title}</span>
      </div>
      <p className="mt-2 text-[12px] leading-5 text-ink-muted">{desc}</p>
    </div>
  )
}

function StatusPill({ status }: { status: StrategyMiningCandidate["status"] }) {
  const label = status === "promoted" ? "晋级" : status === "watchlist" ? "观察" : status === "rejected" ? "淘汰" : "待测"
  return (
    <span className={`rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] ${admissionClass(status)}`}>
      {label}
    </span>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  const color = tone === "up" ? "text-bull" : tone === "down" ? "text-bear" : "text-ink"
  return (
    <div>
      <p className="font-mono text-[9px] text-ink-faint">{label}</p>
      <p className={`mt-1 font-mono text-[15px] ${color}`}>{value}</p>
    </div>
  )
}

function ResearchMiniCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[6px] border border-rule bg-white px-2.5 py-2">
      <p className="font-mono text-[9px] text-ink-faint">{label}</p>
      <p className="mt-1 line-clamp-1 text-[12px] text-ink">{value}</p>
    </div>
  )
}

function ResearchList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-[7px] border border-rule bg-white px-3 py-2">
      <p className="font-mono text-[10px] text-ink-muted">{title}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.slice(0, 6).map((item) => (
          <span key={item} className="rounded-[5px] border border-rule bg-[#fafafa] px-2 py-1 text-[11px] leading-4 text-ink-muted">
            {item}
          </span>
        ))}
      </div>
    </div>
  )
}

function formatPercent(value?: number) {
  if (value == null || !Number.isFinite(value)) return "N/A"
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
}

function admissionClass(status: StrategyMiningCandidate["status"]) {
  return status === "promoted"
    ? "text-bull"
    : status === "watchlist"
      ? "text-warning"
      : status === "rejected"
        ? "text-bear"
        : "text-ink-muted"
}

function summarizeIncubation(report: StrategyMiningReport) {
  const candidates = report.candidates.filter((candidate) => candidate.incubation)
  const averageScore = candidates.length
    ? Math.round(candidates.reduce((sum, candidate) => sum + (candidate.incubation?.score ?? 0), 0) / candidates.length)
    : 0
  return {
    averageScore,
    paperWatch: candidates.filter((candidate) => candidate.incubation?.gate === "模拟观察").length,
    retest: candidates.filter((candidate) => candidate.incubation?.gate === "修正复测").length,
    highOverfit: candidates.filter((candidate) => candidate.incubation?.overfitRisk === "high").length,
    walkForwardPass: candidates.filter((candidate) => candidate.incubation?.walkForward.pass).length,
    multiRegime: candidates.filter((candidate) => (candidate.incubation?.marketCoverage ?? 0) >= 2).length,
    dataGaps: candidates.filter((candidate) => candidate.report?.backtestSource !== "Qveris").length,
  }
}

function summarizeResearch(report: StrategyMiningReport) {
  const counts = new Map<string, number>()
  const needs = new Set<string>()
  for (const candidate of report.candidates) {
    counts.set(candidate.research.archetype, (counts.get(candidate.research.archetype) ?? 0) + 1)
    candidate.research.dataNeeds.forEach((item) => needs.add(item))
  }
  const archetypes = ["突破", "趋势", "回踩", "均值回归", "资金事件", "日内", "防守"].map((label) => ({
    label,
    value: counts.get(label) ?? 0,
    tone: label === "资金事件" || label === "日内" ? "warning" as const : undefined,
  }))
  return {
    archetypes,
    totalDataNeeds: needs.size,
    nextActions: [
      {
        title: "扩源",
        desc: "继续用 GitHub 与公开模板扩展候选，但只保留能转成内部因子的可解释规则。",
      },
      {
        title: "补数据",
        desc: "资金、新闻、财报和分钟线策略先进入数据补齐队列，不把代理结果当成最终准入。",
      },
      {
        title: "准入",
        desc: "真实回测通过后同步注册表，再进入雷达候选或 L5 模拟观察账户。",
      },
    ],
  }
}

function incubationClass(gate: NonNullable<StrategyMiningCandidate["incubation"]>["gate"]) {
  return gate === "雷达候选"
    ? "text-bull"
    : gate === "模拟观察"
      ? "text-health-ok"
      : gate === "修正复测"
        ? "text-warning"
        : "text-bear"
}

function gridStatusClass(status: "pass" | "watch" | "fail") {
  return status === "pass" ? "text-bull" : status === "watch" ? "text-warning" : "text-bear"
}

function riskLabel(risk: NonNullable<StrategyMiningCandidate["incubation"]>["overfitRisk"]) {
  return risk === "low" ? "低" : risk === "medium" ? "中" : "高"
}
