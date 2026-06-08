import { PageMasthead, PageShell } from "@/components/shared/page-shell"

export const metadata = {
  title: "社区市场 — Stock Radar",
}

export default function MarketPage() {
  return (
    <PageShell width="wide">
      <PageMasthead
        layer="Layer 4"
        layerEn="Marketplace"
        title="社区市场"
        subtitle="策略商城、因子市场、排行榜、订阅。把你打磨过的策略分享出去，或者订阅别人的策略到自己的雷达。"
      />

      <div className="mt-5 grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)] 2xl:grid-cols-[420px_minmax(0,1fr)]">
        <section className="rounded-[7px] border border-rule bg-white px-4 py-5 md:px-5">
          <p className="font-mono text-[11px] text-ink-muted">
            Coming Soon
          </p>
          <p className="mt-4 text-[26px] font-semibold leading-tight text-ink">
            先把 L0 - L3 跑通，再开放市场。
          </p>
          <p className="mt-3 text-sm leading-6 text-ink-muted">
            当前优先级是数据真实、因子可复算、雷达能追踪。市场页先作为路线图看板。
          </p>
          <div className="mt-5 grid grid-cols-3 gap-2">
            <MiniStat label="阶段" value="V3" />
            <MiniStat label="状态" value="Beta" />
            <MiniStat label="入口" value="待开放" />
          </div>
        </section>

        <section className="rounded-[7px] border border-rule bg-white px-4 py-4 md:px-5">
          <p className="font-mono text-[11px] text-ink-muted">
            规划
          </p>
          <ol className="mt-4 grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
            <Item n="01" t="策略商城" d="作者上架公开策略，按订阅、按月、或免费分享。" />
            <Item n="02" t="因子市场" d="基础因子免费，专有 AI 因子按调用付费。" />
            <Item n="03" t="排行榜" d="按 Sharpe / 年化 / 回撤 / 订阅数多维度排序。" />
            <Item n="04" t="订阅" d="一键把别人的策略加到自己的雷达扫描里。" />
            <Item n="05" t="审核" d="所有上架策略需经过样本外回测与抗过拟合检查。" />
          </ol>
        </section>
      </div>
    </PageShell>
  )
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-2">
      <p className="font-mono text-[10px] text-ink-faint">{label}</p>
      <p className="mt-1 font-mono text-[13px] text-ink">{value}</p>
    </div>
  )
}

function Item({ n, t, d }: { n: string; t: string; d: string }) {
  return (
    <li className="rounded-[7px] border border-rule bg-[#fafafa] px-3 py-3">
      <span className="font-mono text-[10px] text-ink-faint">{n}</span>
      <div>
        <span className="mt-1 block text-[15px] font-semibold text-ink">{t}</span>
        <span className="mt-1 block text-[13px] leading-5 text-ink-muted">{d}</span>
      </div>
    </li>
  )
}
