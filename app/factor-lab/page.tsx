import { BrainCircuit, Database, FlaskConical, GitBranch, LineChart, ShieldCheck } from "lucide-react"
import type { ReactNode } from "react"
import { AIFactorLab } from "@/components/factors/ai-factor-lab"
import { PageMasthead, PageShell } from "@/components/shared/page-shell"
import { DATA_SOURCES, FACTORS } from "@/lib/catalog"
import { buildFactorAssets, factorAssetSummary } from "@/lib/factor-assets"
import { getDefaultModelRuntime } from "@/lib/model-providers"

export const metadata = {
  title: "因子实验台 — Stock Radar",
}

export default function FactorLabPage() {
  const assets = buildFactorAssets(FACTORS)
  const summary = factorAssetSummary(assets)
  const defaultModel = getDefaultModelRuntime()

  return (
    <PageShell width="wide">
      <PageMasthead
        layer="Layer 1"
        layerEn="Factor Lab"
        title="因子实验台"
        subtitle="把自然语言想法、交易经验和文档规则转成候选因子。实验台负责生成 DSL、识别数据字段、设计验证计划；通过验证后再进入因子资产库，被策略和雷达调用。"
      />

      <section className="mt-5 grid gap-3 xl:grid-cols-4">
        <PipelineCard
          icon={<BrainCircuit className="size-4" aria-hidden />}
          title="01 生成"
          desc="自然语言转候选因子，输出公式、方向、字段和 DSL。"
        />
        <PipelineCard
          icon={<Database className="size-4" aria-hidden />}
          title="02 绑定"
          desc="检查 Qveris / 数据库字段，区分真实字段、代理字段和缺口。"
        />
        <PipelineCard
          icon={<LineChart className="size-4" aria-hidden />}
          title="03 验证"
          desc="做单因子 IC、IR、Q1-Q5、覆盖率和换手成本测试。"
        />
        <PipelineCard
          icon={<ShieldCheck className="size-4" aria-hidden />}
          title="04 入库"
          desc="通过门槛后沉淀为因子资产，再进入策略组合。"
        />
      </section>

      <section className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.55fr)]">
        <div className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <FlaskConical className="size-4" aria-hidden />
            admission gates
          </div>
          <h2 className="mt-2 text-[20px] font-semibold text-ink">因子准入门槛</h2>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            <Gate label="预测力" value="IC 均值 > 0.02 / IR > 0.3" />
            <Gate label="分组收益" value="Q1-Q5 为正，分组尽量单调" />
            <Gate label="可复现" value="字段覆盖率 > 90%，没有未来函数" />
            <Gate label="可组合" value="与核心因子相关性不过度拥挤" />
          </div>
        </div>
        <div className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink-muted">
            <GitBranch className="size-4" aria-hidden />
            current library
          </div>
          <h2 className="mt-2 text-[20px] font-semibold text-ink">当前因子池状态</h2>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <LabKpi label="总因子" value={summary.total} />
            <LabKpi label="已验证" value={summary.validated} good />
            <LabKpi label="观察中" value={summary.watchlist} />
            <LabKpi label="数据待补" value={summary.dataGap} warning />
          </div>
        </div>
      </section>

      <AIFactorLab defaultModel={defaultModel} />

      <section className="mt-5 rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] text-ink-muted">data map</p>
            <h2 className="mt-2 text-[20px] font-semibold text-ink">可绑定数据源</h2>
          </div>
          <span className="font-mono text-[11px] text-ink-muted">{DATA_SOURCES.length} 个数据源</span>
        </div>
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {DATA_SOURCES.slice(0, 9).map((source) => (
            <div key={source.id} className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-ink">{source.name}</p>
                  <p className="mt-1 font-mono text-[10px] text-ink-faint">{source.category} · {source.freq}</p>
                </div>
                <span className="rounded-[5px] border border-rule bg-white px-2 py-1 font-mono text-[10px] text-ink-muted">
                  {source.provider}
                </span>
              </div>
              <p className="mt-2 text-[12px] leading-5 text-ink-muted">{source.desc}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {source.fields.slice(0, 5).map((field) => (
                  <span key={field} className="rounded-[5px] border border-rule bg-white px-2 py-1 font-mono text-[10px] text-ink-muted">
                    {field}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </PageShell>
  )
}

function PipelineCard({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-[7px] border border-rule bg-white px-4 py-4">
      <div className="flex items-center gap-2 font-mono text-[11px] text-[#1e5a91]">
        {icon}
        {title}
      </div>
      <p className="mt-3 text-[13px] leading-6 text-ink-muted">{desc}</p>
    </div>
  )
}

function Gate({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className="mt-2 text-[13px] leading-5 text-ink">{value}</p>
    </div>
  )
}

function LabKpi({ label, value, good, warning }: { label: string; value: number; good?: boolean; warning?: boolean }) {
  const tone = good ? "text-health-ok" : warning ? "text-warning" : "text-ink"
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className={`mt-2 font-mono text-[22px] font-semibold ${tone}`}>{value}</p>
    </div>
  )
}
