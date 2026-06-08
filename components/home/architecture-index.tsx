import Link from "next/link"
import { ArrowRight } from "lucide-react"

const LAYERS = [
  {
    n: "L0",
    href: "/data",
    title: "数据层",
    en: "Data",
    desc: "行情K线 · 财务数据 · 资金流向 · 龙虎榜 · 公告新闻 · 链上情绪",
    cta: "浏览数据源",
    status: "12 个已接入",
  },
  {
    n: "L1",
    href: "/factors",
    title: "因子层",
    en: "Factors",
    desc: "因子资产库 + 因子实验台。新想法先生成 DSL 和验证计划，通过单因子测试后再进入策略。",
    cta: "进入因子资产库",
    status: "库 / 实验台",
  },
  {
    n: "L2",
    href: "/strategy-research",
    title: "策略与回测",
    en: "Strategy",
    desc: "策略研究 → 真实回测 → 正式目录。先生成候选，再用 Qveris 历史数据验证，最后才接入雷达。",
    cta: "进入策略流水线",
    status: "研究 / 回测 / 目录",
  },
  {
    n: "L3",
    href: "/radar",
    title: "策略雷达",
    en: "Radar",
    desc: "交易日盘中扫描市场，把策略命中的标的整理成研究报告：买点、风控线、胜率、赔率。",
    cta: "进入策略雷达",
    status: "北京时间盘中每 10m 扫描",
  },
  {
    n: "L4",
    href: "/assistant",
    title: "智能与市场",
    en: "AI / Market",
    desc: "自然语言研究、策略市场、因子市场与订阅，把工具链扩展成可协作的研究生态。",
    cta: "进入自然语言研究",
    status: "Beta",
  },
  {
    n: "L5",
    href: "/simulation",
    title: "实盘模拟",
    en: "Paper Trading",
    desc: "通过真实回测的策略进入纸面账户，跟踪资产曲线、持仓、交易记录和风险状态。",
    cta: "进入模拟盘",
    status: "新层",
  },
]

export function ArchitectureIndex() {
  return (
    <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
      <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="font-mono text-[11px] text-ink-muted">Index · 平台目录</p>
          <h2 className="mt-2 text-[24px] font-semibold text-ink">六层架构</h2>
        </div>
        <p className="max-w-[520px] text-[13px] leading-6 text-ink-muted md:text-right">
          每一层都是独立工具，也可以串起来用。数据沉淀为因子，因子组合成策略，策略产出雷达，再进入模拟执行观察。
        </p>
      </div>

      <ol className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {LAYERS.map((layer, i) => (
          <li key={layer.title + i}>
            <Link
              href={layer.href}
              className="group block h-full rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3 transition-colors hover:bg-white"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-ink-muted">
                    <span>{layer.n}</span>
                    <span>{layer.en}</span>
                    <span className="rounded-[5px] border border-rule bg-white px-1.5 py-0.5">{layer.status}</span>
                  </div>
                  <h3 className="mt-2 text-[18px] font-semibold text-ink">{layer.title}</h3>
                  <p className="mt-2 text-[13px] leading-6 text-ink-muted">{layer.desc}</p>
                </div>
                <ArrowRight className="mt-1 size-4 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
              </div>
              <p className="mt-3 font-mono text-[11px] text-ink">{layer.cta}</p>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
