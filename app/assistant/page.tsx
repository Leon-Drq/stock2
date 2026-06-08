import { AssistantClient } from "@/components/assistant/assistant-client"
import { PageMasthead, PageShell } from "@/components/shared/page-shell"

export const metadata = {
  title: "AI 助手 — Stock Radar",
}

const EXAMPLES = [
  "找出最近三天放量突破年线、且北向加仓的票",
  "买入超跌反弹的策略，止损放在前低，胜率最大化",
  "我发现 002518 这个票最近涨得好，帮我分析它走强的因子，能不能做成雷达扫全市场",
  "构建一个日内交易策略，专门做高开低走的标的",
  "找一个适合波段的低相关因子组合，年化 25% 以上",
]

export default function AssistantPage() {
  return (
    <PageShell width="wide">
      <PageMasthead
        layer="Layer 4"
        layerEn="AI Assistant"
        title="自然语言研究"
        subtitle="一句话描述你的想法，AI 帮你拆解成数据查询 + 因子组合 + 策略代码 + 回测报告。像和一位量化研究员对话。"
      />

      <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_440px]">
        <AssistantClient examples={EXAMPLES} compact />

        <aside className="space-y-5 xl:sticky xl:top-5 xl:self-start">
          <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
            <p className="font-mono text-[11px] text-ink-muted">
              示例提问
            </p>
            <ul className="mt-4 space-y-2">
              {EXAMPLES.map((q, i) => (
                <li key={i} className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
                  <p className="flex items-baseline gap-3 text-[13px] leading-5 text-ink-muted">
                    <span className="shrink-0 font-mono text-[10px] text-ink-faint">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span>“{q}”</span>
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
            <p className="font-mono text-[11px] text-ink-muted">
              能力清单
            </p>
            <ol className="mt-4 grid gap-2">
              <Capability
                n="01"
                title="数据查询"
                desc="自然语言转 Qveris API 调用，自动选择最合适的工具。"
              />
              <Capability
                n="02"
                title="因子推荐"
                desc="基于你的描述从因子库里筛出 IC 值最高的 3-5 个组合。"
              />
              <Capability
                n="03"
                title="策略生成"
                desc="直接输出回测代码 + 风控规则 + 仓位管理逻辑。"
              />
              <Capability
                n="04"
                title="反向因子发现"
                desc="给一只标的，AI 拆解它走强的因子，自动构建监控雷达扫描相似机会。"
              />
            </ol>
          </section>
        </aside>
      </div>
    </PageShell>
  )
}

function Capability({ n, title, desc }: { n: string; title: string; desc: string }) {
  return (
    <li className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <span className="font-mono text-[10px] text-ink-faint">{n}</span>
      <div>
        <span className="mt-1 block text-[15px] font-semibold text-ink">{title}</span>
        <span className="mt-1 block text-[13px] leading-5 text-ink-muted">{desc}</span>
      </div>
    </li>
  )
}
