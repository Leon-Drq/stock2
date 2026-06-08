import { PageMasthead, PageShell } from "@/components/shared/page-shell"
import { BacktestDataCacheSection } from "@/components/data/backtest-data-cache-section"
import { BacktestReadinessSection } from "@/components/data/backtest-readiness-section"
import { DataHealthClientSection } from "@/components/data/data-health-client-section"
import { DataTrustSection } from "@/components/data/data-trust-section"
import { NonPriceDataPanel } from "@/components/data/non-price-data-panel"
import { QverisUsageSection } from "@/components/data/qveris-usage-section"
import { SignalIntegritySection } from "@/components/data/signal-integrity-section"

export const metadata = {
  title: "数据层 — Stock Radar",
}

export const dynamic = "force-dynamic"

export default function DataPage() {
  return (
    <PageShell width="wide">
      <PageMasthead
        layer="Layer 0"
        layerEn="Data"
        title="数据源目录"
        subtitle="一切研究的起点。通过 Qveris 统一接入，每个数据源都监控其工具匹配情况、成功率与延迟 — 像图书馆的卡片目录，但每张卡片都活着。"
      />
      <DataTrustSection />
      <SignalIntegritySection />
      <QverisUsageSection />
      <BacktestReadinessSection />
      <NonPriceDataPanel />
      <DataHealthClientSection />
      <BacktestDataCacheSection />
    </PageShell>
  )
}
