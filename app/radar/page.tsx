import { Masthead } from "@/components/radar/masthead"
import { RadarLivePanel } from "@/components/radar/radar-live-panel"
import { SiteNav } from "@/components/radar/site-nav"
import { getChinaMarketSession } from "@/lib/cn-market-session"
import { fallbackReport } from "@/lib/radar-data"

export const metadata = {
  title: "策略雷达 · 上线扫描 — Stock Radar",
}

// 调试阶段每次刷新都重算；接入 Qveris 稳定后再把 revalidate 调回 300。
export const dynamic = "force-dynamic"

export default async function RadarPage() {
  const marketSession = getChinaMarketSession()
  const initialReport = {
    ...fallbackReport,
    generatedAt: new Date().toISOString(),
    conclusion: "正在读取策略注册表、Qveris 行情和上线雷达信号。",
    suggestions: [],
    trackRecord: undefined,
  }
  const initialDiagnostics = {
    source: "fallback" as const,
    qverisCount: 0,
    mockCount: 0,
    quoteCount: 0,
    quoteTotal: 0,
    marketSession,
    factorIRs: [],
    fallbackReason: "首屏先显示轻量壳，随后由浏览器拉取真实雷达结果。",
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f7f7f6] text-ink">
      <SiteNav />
      <main className="min-w-0 lg:pl-[232px]">
        <Masthead reportType={initialReport.reportType} generatedAt={initialReport.generatedAt} />
        <RadarLivePanel initialReport={initialReport} initialDiagnostics={initialDiagnostics} initialMarketSession={marketSession} />
      </main>
    </div>
  )
}
