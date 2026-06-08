import Link from "next/link"
import { ArrowRight, CheckCircle2, ClipboardList, FlaskConical, LineChart, Radar, WalletCards } from "lucide-react"

type StrategyPipelineStepId = "research" | "backtest" | "catalog" | "radar" | "paper"

const STEPS: Array<{
  id: StrategyPipelineStepId
  href: string
  title: string
  eyebrow: string
  desc: string
  icon: typeof ClipboardList
}> = [
  {
    id: "research",
    href: "/strategy-research",
    title: "策略研究",
    eyebrow: "01 / collect",
    desc: "候选、矿工、实验室只负责产生可解释策略草稿。",
    icon: ClipboardList,
  },
  {
    id: "backtest",
    href: "/backtest",
    title: "真实回测",
    eyebrow: "02 / verify",
    desc: "用 Qveris 历史数据、成本、回撤和样本稳定性打分。",
    icon: LineChart,
  },
  {
    id: "catalog",
    href: "/strategies",
    title: "正式目录",
    eyebrow: "03 / approve",
    desc: "只展示通过准入的策略，未达标留在回测诊断。",
    icon: FlaskConical,
  },
  {
    id: "radar",
    href: "/radar",
    title: "策略雷达",
    eyebrow: "04 / scan",
    desc: "盘中只运行已上线策略，输出动作级信号。",
    icon: Radar,
  },
  {
    id: "paper",
    href: "/simulation",
    title: "实盘模拟",
    eyebrow: "05 / observe",
    desc: "每个策略独立模拟账户，观察持仓、交易和复盘。",
    icon: WalletCards,
  },
]

export function StrategyPipelineStrip({
  current,
  summary,
}: {
  current: StrategyPipelineStepId
  summary?: string
}) {
  const currentIndex = STEPS.findIndex((step) => step.id === current)

  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-3 py-3 md:px-4">
      <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-mono text-[11px] text-ink-muted">P2 · Strategy Pipeline</p>
          <h2 className="mt-1 text-[18px] font-semibold text-ink">策略上线只走一条路</h2>
        </div>
        <p className="max-w-[660px] text-[12px] leading-5 text-ink-muted md:text-right">
          {summary ?? "先研究，再真实回测，最后进入正式目录、雷达和模拟盘；候选策略不再直接混进用户看到的交易入口。"}
        </p>
      </div>

      <ol className="grid gap-2 lg:grid-cols-5">
        {STEPS.map((step, index) => {
          const Icon = step.icon
          const active = step.id === current
          const completed = index < currentIndex
          return (
            <li key={step.id}>
              <Link
                href={step.href}
                aria-current={active ? "step" : undefined}
                className={`group flex h-full min-h-[132px] flex-col justify-between rounded-[7px] border px-3 py-3 transition-colors ${
                  active
                    ? "border-ink bg-ink text-paper"
                    : completed
                      ? "border-[#cfe6d6] bg-[#f3faf5] text-ink"
                      : "border-rule bg-[#fafafa] text-ink hover:bg-white"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`font-mono text-[10px] ${active ? "text-paper/65" : "text-ink-muted"}`}>
                      {step.eyebrow}
                    </span>
                    {completed ? (
                      <CheckCircle2 className="size-4 text-health-ok" aria-hidden />
                    ) : (
                      <Icon className={`size-4 ${active ? "text-paper" : "text-ink-muted"}`} aria-hidden />
                    )}
                  </div>
                  <h3 className="mt-3 text-[15px] font-semibold">{step.title}</h3>
                  <p className={`mt-2 text-[12px] leading-5 ${active ? "text-paper/75" : "text-ink-muted"}`}>
                    {step.desc}
                  </p>
                </div>
                <div className={`mt-3 flex items-center gap-1 font-mono text-[11px] ${active ? "text-paper" : "text-ink"}`}>
                  {active ? "当前步骤" : completed ? "已通过" : "进入"}
                  <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </div>
              </Link>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
