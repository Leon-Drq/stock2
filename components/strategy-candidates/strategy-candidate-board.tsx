import Link from "next/link"
import type { ReactNode } from "react"
import {
  CheckCircle2,
  CircleAlert,
  Database,
  ExternalLink,
  FlaskConical,
  LineChart,
  Radar,
  ShieldCheck,
  Sparkles,
  TestTube2,
} from "lucide-react"
import {
  STRATEGY_CANDIDATES,
  readinessLabel,
  stageTone,
  strategyCandidateSummary,
  type StrategyCandidate,
  type StrategyCandidatePriority,
  type StrategyCandidateReadiness,
} from "@/lib/strategy-candidates"

const PRIORITY_LABELS: Record<StrategyCandidatePriority, string> = {
  P1: "优先落地",
  P2: "补数据后测",
  P3: "研究观察",
}

export function StrategyCandidateBoard() {
  const summary = strategyCandidateSummary()
  const grouped = groupByPriority(STRATEGY_CANDIDATES)

  return (
    <div className="mt-5 space-y-5">
      <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="font-mono text-[11px] text-ink-muted">candidate pool</p>
            <h2 className="mt-2 text-[20px] font-semibold text-ink">从公开策略到可回测候选</h2>
            <p className="mt-2 max-w-[860px] text-[13px] leading-6 text-ink-muted">
              这里先放“值得研究”的策略，不直接承诺收益。候选必须经过数据可用性、真实回测、样本外、交易成本和模拟盘观察，才允许进入策略目录和策略雷达。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:min-w-[620px]">
            <SummaryCard label="候选" value={summary.total} tone="good" />
            <SummaryCard label="P1" value={summary.p1} tone="good" />
            <SummaryCard label="可代理回测" value={summary.proxyBacktest} tone="good" />
            <SummaryCard label="需补数据" value={summary.dataGap} tone="warning" />
            <SummaryCard label="雷达目标" value={summary.radarTargets} tone="good" />
          </div>
        </div>
      </section>

      <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] text-ink-muted">research pipeline</p>
            <h2 className="mt-2 text-[18px] font-semibold text-ink">上线前五道门</h2>
          </div>
          <span className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink-muted">
            北京时间 · research queue
          </span>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-5">
          <PipelineStep icon={<Sparkles className="size-4" />} title="搜集" desc="公开策略、GitHub、经典交易体系" />
          <PipelineStep icon={<Database className="size-4" />} title="数据" desc="标出 Qveris 已有、代理和缺失字段" />
          <PipelineStep icon={<LineChart className="size-4" />} title="回测" desc="真实历史 K 线和交易成本约束" />
          <PipelineStep icon={<ShieldCheck className="size-4" />} title="孵化" desc="样本外、参数压力、市场分层" />
          <PipelineStep icon={<Radar className="size-4" />} title="准入" desc="策略目录、雷达、独立模拟账户" />
        </div>
      </section>

      <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] text-ink-muted">next batch</p>
            <h2 className="mt-2 text-[18px] font-semibold text-ink">建议先跑这一批</h2>
            <p className="mt-1 max-w-[820px] text-[13px] leading-5 text-ink-muted">
              第一批优先选择能用现有 K 线代理复现的策略；右上角是候选优先级，不是历史回测得分。北向、财务、涨停和分钟线策略先保留在数据补齐队列。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/backtest" label="去真实回测" icon={<LineChart className="size-3.5" />} />
            <LinkButton href="/strategy-research?tab=miner" label="去策略矿工" icon={<FlaskConical className="size-3.5" />} />
          </div>
        </div>
        <div className="mt-4 grid gap-2 lg:grid-cols-3">
          {STRATEGY_CANDIDATES.filter((item) => item.priority === "P1").map((candidate) => (
            <PriorityPick key={candidate.id} candidate={candidate} />
          ))}
        </div>
      </section>

      {(["P1", "P2", "P3"] as const).map((priority) => (
        <section key={priority} className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] text-ink-muted">{priority} · {PRIORITY_LABELS[priority]}</p>
              <h2 className="mt-2 text-[18px] font-semibold text-ink">{priority === "P1" ? "先转策略 DSL 的候选" : priority === "P2" ? "等数据补齐后验证" : "研究基线与长期储备"}</h2>
            </div>
            <span className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2 font-mono text-[11px] text-ink-muted">
              {grouped[priority].length} candidates
            </span>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {grouped[priority].map((candidate) => (
              <CandidateCard key={candidate.id} candidate={candidate} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function CandidateCard({ candidate }: { candidate: StrategyCandidate }) {
  const tone = stageTone(candidate.stage)
  return (
    <article className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3 md:px-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StageBadge tone={tone} label={candidate.stage} />
            <span className="rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
              {candidate.family}
            </span>
            <span className="rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-muted">
              候选分 {candidate.score}
            </span>
            <span className="rounded-[5px] border border-rule bg-white px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
              非回测分
            </span>
          </div>
          <h3 className="mt-2 text-[17px] font-semibold leading-snug text-ink">{candidate.name}</h3>
          <p className="mt-2 text-[13px] leading-6 text-ink-muted">{candidate.thesis}</p>
        </div>
        <a
          href={candidate.sourceUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`打开 ${candidate.name} 的公开来源`}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[7px] border border-rule bg-white px-3 font-mono text-[11px] text-ink transition hover:bg-[#f5f5f4]"
        >
          来源 <ExternalLink className="size-3.5" aria-hidden />
        </a>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        <RuleBlock title="触发规则" items={candidate.rules} />
        <RuleBlock title="退出 / 风控" items={candidate.exitRules} />
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-3">
        <InfoTile label="持有周期" value={candidate.holdingPeriod} />
        <InfoTile label="下一步" value={candidate.nextAction} />
        <InfoTile label="来源" value={candidate.sourceName} />
      </div>

      <div className="mt-4">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">data readiness</p>
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          {candidate.dataNeeds.map((need) => (
            <DataNeed key={`${candidate.id}-${need.name}`} need={need} />
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {candidate.factors.map((factor) => (
          <span key={factor} className="rounded-[5px] border border-rule bg-white px-2 py-1 font-mono text-[10px] text-ink-soft">
            {factor}
          </span>
        ))}
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-2">
        <RuleBlock title="反过拟合检查" items={candidate.antiOverfitChecks} compact />
        <RuleBlock title="主要风险" items={candidate.cautions} compact />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-rule pt-3">
        <div className="flex flex-wrap gap-1.5">
          {candidate.targetUse.map((target) => (
            <span key={target} className="rounded-[5px] bg-[#e7f4eb] px-2 py-1 font-mono text-[10px] text-health-ok">
              {target}
            </span>
          ))}
        </div>
        <Link
          href={`/strategy-research?tab=lab&candidate=${encodeURIComponent(candidate.id)}`}
          className="inline-flex h-8 items-center rounded-[7px] border border-rule bg-white px-3 font-mono text-[11px] text-ink transition hover:bg-[#f5f5f4]"
        >
          转策略实验室 →
        </Link>
      </div>
    </article>
  )
}

function PriorityPick({ candidate }: { candidate: StrategyCandidate }) {
  return (
    <article className="rounded-[7px] border border-rule bg-[#fafafa] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] text-ink-muted">{candidate.family} · {candidate.stage}</p>
          <h3 className="mt-2 text-[15px] font-semibold text-ink">{candidate.name}</h3>
        </div>
        <span className="shrink-0 rounded-[5px] bg-ink px-2 py-1 font-mono text-[10px] text-paper">
          候选分 {candidate.score}
        </span>
      </div>
      <p className="mt-2 line-clamp-3 text-[12px] leading-5 text-ink-muted">{candidate.thesis}</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {candidate.factors.slice(0, 3).map((factor) => (
          <span key={factor} className="rounded-[5px] border border-rule bg-white px-2 py-0.5 font-mono text-[10px] text-ink-soft">
            {factor}
          </span>
        ))}
      </div>
    </article>
  )
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: "good" | "warning" | "bad" }) {
  const cls = tone === "good" ? "text-health-ok" : tone === "warning" ? "text-warning" : "text-bear"
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className={`mt-1 font-mono text-[20px] font-semibold ${cls}`}>{value}</p>
    </div>
  )
}

function PipelineStep({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
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

function RuleBlock({ title, items, compact = false }: { title: string; items: string[]; compact?: boolean }) {
  return (
    <div className="rounded-[7px] border border-rule bg-white px-3 py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">{title}</p>
      <ul className={`mt-2 space-y-1.5 text-[12px] leading-5 text-ink-muted ${compact ? "" : "min-h-[88px]"}`}>
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-[0.45rem] size-1 shrink-0 rounded-full bg-ink-faint" aria-hidden />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[7px] border border-rule bg-white px-3 py-2">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className="mt-1 text-[12px] leading-5 text-ink-muted">{value}</p>
    </div>
  )
}

function DataNeed({ need }: { need: { name: string; status: StrategyCandidateReadiness; note: string } }) {
  const cls =
    need.status === "ready"
      ? "bg-[#e7f4eb] text-health-ok"
      : need.status === "proxy"
        ? "bg-[#fff7ed] text-warning"
        : "bg-[#fff1f2] text-bear"
  const Icon = need.status === "ready" ? CheckCircle2 : need.status === "proxy" ? TestTube2 : CircleAlert
  return (
    <div className="rounded-[7px] border border-rule bg-white px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] font-semibold text-ink">{need.name}</p>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-[5px] px-1.5 py-0.5 font-mono text-[10px] ${cls}`}>
          <Icon className="size-3" aria-hidden />
          {readinessLabel(need.status)}
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-ink-muted">{need.note}</p>
    </div>
  )
}

function StageBadge({ tone, label }: { tone: "good" | "warning" | "bad"; label: string }) {
  const cls = tone === "good" ? "bg-[#e7f4eb] text-health-ok" : tone === "warning" ? "bg-[#fff7ed] text-warning" : "bg-[#fff1f2] text-bear"
  return <span className={`rounded-[5px] px-2 py-1 font-mono text-[10px] ${cls}`}>{label}</span>
}

function LinkButton({ href, label, icon }: { href: string; label: string; icon: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-9 items-center gap-1.5 rounded-[7px] border border-rule bg-[#fafafa] px-3 font-mono text-[11px] text-ink transition hover:bg-white"
    >
      {icon}
      {label}
    </Link>
  )
}

function groupByPriority(candidates: StrategyCandidate[]) {
  return candidates.reduce(
    (groups, candidate) => {
      groups[candidate.priority].push(candidate)
      return groups
    },
    { P1: [], P2: [], P3: [] } as Record<StrategyCandidatePriority, StrategyCandidate[]>,
  )
}
